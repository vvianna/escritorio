#!/usr/bin/env bash
# Gera o docker-compose.override.yml com as montagens SOMENTE LEITURA do Hermes para o escritório.
#
# Monta PASTAS (o SQLite em WAL cria e apaga os -wal/-shm o tempo todo; montar esses arquivos um a um quebra o `up`
# com "bind source path does not exist" quando eles somem). Nunca a pasta de perfil (lá ficam .env, auth.json e
# config.yaml), nunca um arquivo -wal/-shm:
#   ~/.hermes/kanban/          -> /hermes/kanban            (boards nomeados: kanban/boards/<b>/kanban.db)
#   ~/.hermes/kanban.db        -> /hermes/kanban.db         (board "default"; só o arquivo principal, porque a pasta
#                                                            ~/.hermes não pode entrar. Sem -shm visível o código
#                                                            reabre com immutable=1, ver openReadOnly em hermes.ts)
#   ~/.cache/escritorio/       -> /cache/escritorio         (uso.jsonl + agy-cota.tsv, gerados no host por
#                                                            tools/copiar-uso.sh: é daí que sai o gasto por assinatura)
#   ~/.hermes/time/nomes.json  -> /hermes/time/nomes.json   (nomes do time, se existir)
# Os state.db dos perfis NÃO entram: o uso vem só pelo uso.jsonl.
# Tudo com read_only: true e create_host_path: false. A pasta ~/.cache/escritorio é criada aqui (vazia) para o `up`
# não falhar antes da primeira cópia.
#
# Rode de novo antes de cada `docker compose up` (board novo já entra pela pasta, sem regenerar).
# Variáveis: ESCRITORIO_HERMES_DIR (padrão ~/.hermes; de propósito NÃO é HERMES_HOME, que dentro do Hermes aponta
# para o perfil), ESCRITORIO_CACHE_DIR (padrão ~/.cache/escritorio), ESCRITORIO_OVERRIDE (padrão
# ./docker-compose.override.yml).
set -euo pipefail

H="${ESCRITORIO_HERMES_DIR:-$HOME/.hermes}"
CACHE="${ESCRITORIO_CACHE_DIR:-$HOME/.cache/escritorio}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ESCRITORIO_OVERRIDE:-$RAIZ/docker-compose.override.yml}"

[ -d "$H" ] || { echo "erro: pasta do Hermes não encontrada: $H" >&2; exit 1; }

linhas=()
n=0
monta() { # <origem no host> <destino no container>
  case "$1" in *-wal | *-shm) echo "erro: recusado montar $1 (arquivo do SQLite que some)" >&2; exit 1 ;; esac
  linhas+=("      - type: bind"
           "        source: \"$1\""
           "        target: \"$2\""
           "        read_only: true"
           "        bind:"
           "          create_host_path: false")
  n=$((n + 1))
}

[ -d "$H/kanban" ] && monta "$H/kanban" /hermes/kanban
[ -f "$H/kanban.db" ] && monta "$H/kanban.db" /hermes/kanban.db
[ "$n" -gt 0 ] || { echo "erro: nem $H/kanban/ nem $H/kanban.db existem" >&2; exit 1; }

mkdir -p "$CACHE"
chmod 755 "$CACHE"
monta "$CACHE" /cache/escritorio
[ -f "$H/time/nomes.json" ] && monta "$H/time/nomes.json" /hermes/time/nomes.json

tmp="$(mktemp "$OUT.XXXXXX")"
{
  echo "# GERADO por tools/gerar-montagens.sh em $(date -Iseconds). Não edite: rode o script de novo."
  echo "# Só pastas/arquivos do Hermes sem segredo, todos read-only. Nunca .env, auth.json, config.yaml nem -wal/-shm."
  echo "services:"
  echo "  escritorio:"
  echo "    volumes:"
  printf '%s\n' "${linhas[@]}"
} >"$tmp"
chmod 644 "$tmp"
mv "$tmp" "$OUT"
echo "ok: $n montagens read-only em $OUT"
[ -f "$CACHE/uso.jsonl" ] || echo "aviso: $CACHE/uso.jsonl ainda não existe (rode tools/copiar-uso.sh ou agende no cron do Hermes)" >&2
