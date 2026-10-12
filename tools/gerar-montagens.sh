#!/usr/bin/env bash
# Gera o docker-compose.override.yml com as montagens SOMENTE LEITURA dos bancos do Hermes.
#
# Monta arquivo por arquivo (nunca a pasta do perfil: lá ficam .env, auth.json e config.yaml):
#   ~/.hermes/kanban.db                      -> /hermes/kanban.db
#   ~/.hermes/kanban/boards/<b>/kanban.db    -> /hermes/kanban/boards/<b>/kanban.db
#   ~/.hermes/state.db                       -> /hermes/state.db              (perfil default)
#   ~/.hermes/profiles/<p>/state.db          -> /hermes/profiles/<p>/state.db
# e os irmãos -wal/-shm de cada um quando existem (o SQLite em WAL precisa deles para ler o que é recente).
# Tudo com read_only: true e create_host_path: false (arquivo sumido = erro no `up`, nunca pasta criada no host).
#
# Rode de novo antes de cada `docker compose up` (perfil ou board novo entra assim).
# Variáveis: ESCRITORIO_HERMES_DIR (padrão ~/.hermes; de propósito NÃO é HERMES_HOME, que dentro do Hermes aponta para o perfil), ESCRITORIO_OVERRIDE (padrão ./docker-compose.override.yml).
set -euo pipefail

H="${ESCRITORIO_HERMES_DIR:-$HOME/.hermes}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ESCRITORIO_OVERRIDE:-$RAIZ/docker-compose.override.yml}"

[ -d "$H" ] || { echo "erro: pasta do Hermes não encontrada: $H" >&2; exit 1; }

# Só nomes simples (board/perfil): letras, números, ponto, hífen e sublinhado.
nome_ok() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }

linhas=()
monta() { # <origem no host> <destino no container>
  local src="$1" dst="$2" ext
  for ext in "" -wal -shm; do
    [ -f "$src$ext" ] || continue
    linhas+=("      - type: bind"
             "        source: \"$src$ext\""
             "        target: \"$dst$ext\""
             "        read_only: true"
             "        bind:"
             "          create_host_path: false")
  done
}

[ -f "$H/kanban.db" ] && monta "$H/kanban.db" /hermes/kanban.db
for db in "$H"/kanban/boards/*/kanban.db; do
  [ -f "$db" ] || continue
  b="$(basename "$(dirname "$db")")"
  nome_ok "$b" || { echo "aviso: board ignorado (nome estranho): $b" >&2; continue; }
  monta "$db" "/hermes/kanban/boards/$b/kanban.db"
done
[ -f "$H/state.db" ] && monta "$H/state.db" /hermes/state.db
for db in "$H"/profiles/*/state.db; do
  [ -f "$db" ] || continue
  p="$(basename "$(dirname "$db")")"
  nome_ok "$p" || { echo "aviso: perfil ignorado (nome estranho): $p" >&2; continue; }
  monta "$db" "/hermes/profiles/$p/state.db"
done

[ "${#linhas[@]}" -gt 0 ] || { echo "erro: nenhum kanban.db/state.db em $H" >&2; exit 1; }

tmp="$(mktemp "$OUT.XXXXXX")"
{
  echo "# GERADO por tools/gerar-montagens.sh em $(date -Iseconds). Não edite: rode o script de novo."
  echo "# Só bancos do Hermes, todos read-only. Nunca .env, auth.json nem config.yaml."
  echo "services:"
  echo "  escritorio:"
  echo "    volumes:"
  printf '%s\n' "${linhas[@]}"
} > "$tmp"
mv "$tmp" "$OUT"
echo "ok: $(( ${#linhas[@]} / 6 )) arquivos montados read-only em $OUT"
