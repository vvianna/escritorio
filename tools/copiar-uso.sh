#!/usr/bin/env bash
# Copia SÓ METADADO de uso dos bancos de sessão do Hermes para ~/.cache/escritorio/uso.jsonl (roda no HOST).
#
# Por quê: o gasto por assinatura (fase 4, item 4.3) precisa dos state.db dos perfis, mas a pasta
# ~/.hermes/profiles/ não pode ir para o container (lá ficam .env, auth.json e config.yaml) e montar os state.db
# arquivo por arquivo quebra (o SQLite cria e apaga -wal/-shm). Então este script lê cada banco no host, SÓ LEITURA
# (URI `mode=ro`), e grava um JSONL pequeno; o container monta só ~/.cache/escritorio:ro e a fonte de uso
# (server/sources/hermes-uso.ts, ESCRITORIO_USO) lê esse arquivo.
#
# Bancos: ~/.hermes/state.db (perfil "default") e ~/.hermes/profiles/<perfil>/state.db.
# Também copia ~/.local/state/agy-cota.tsv (cota do Antigravity, sem segredo) para a mesma pasta, se existir.
#
# PRIVACIDADE (spec time-de-agentes, PROIBIDO): só as colunas de metadado que a 4.3 usa (billing_provider, model,
# tokens, custo, last_seen, source e horários da sessão) + o nome do perfil. Nunca conteúdo de conversa nem quem
# conversa (o teste server/sources/hermes-uso.test.ts confere este arquivo também).
#
# Linhas do uso.jsonl (uma por linha, JSON):
#   {"tipo":"meta","gerado_em":<epoch s>,"versao":1}
#   {"tipo":"uso","perfil":..,"billing_provider":..,"model":..,"input_tokens":..,"output_tokens":..,"estimated_cost_usd":..,"last_seen":..}
#   {"tipo":"sessao","qual":"ultima"|"telegram","perfil":..,"source":..,"model":..,"started_at":..,"ended_at":..,"last_activity_at":..}
#   {"tipo":"falha","perfil":..,"erro":..}
#
# Agendado pelo cron do Hermes a cada 2 min. Grava num temporário e troca com `mv` (o leitor nunca vê meio arquivo).
# Calado quando dá certo (o cron do Hermes em --no-agent entrega o que sair no stdout; vazio = nada). -v mostra o resumo.
# Instalar o agendamento (uma vez, no host; o cron do Hermes só roda scripts de ~/.hermes/scripts/):
#   printf '#!/usr/bin/env bash\nexec bash <repo>/tools/copiar-uso.sh "$@"\n' > ~/.hermes/scripts/escritorio-copiar-uso.sh
#   hermes cron create --name escritorio-copiar-uso --script escritorio-copiar-uso.sh --no-agent --deliver local 'every 2m'
# (<repo> = o clone principal, não uma worktree.)
# Variáveis: ESCRITORIO_HERMES_DIR (padrão ~/.hermes), ESCRITORIO_CACHE_DIR (padrão ~/.cache/escritorio),
#            ESCRITORIO_AGY_COTA (padrão ~/.local/state/agy-cota.tsv), SQLITE3 (caminho do sqlite3).
set -euo pipefail

H="${ESCRITORIO_HERMES_DIR:-$HOME/.hermes}"
DEST="${ESCRITORIO_CACHE_DIR:-$HOME/.cache/escritorio}"
AGY="${ESCRITORIO_AGY_COTA:-$HOME/.local/state/agy-cota.tsv}"
DIAS=7

SQL3="${SQLITE3:-}"
if [ -z "$SQL3" ]; then
  for c in "$(command -v sqlite3 || true)" /home/linuxbrew/.linuxbrew/bin/sqlite3 /usr/bin/sqlite3 /usr/local/bin/sqlite3; do
    if [ -n "$c" ] && [ -x "$c" ]; then SQL3="$c"; break; fi
  done
fi
[ -n "$SQL3" ] || { echo "erro: sqlite3 não encontrado (defina SQLITE3)" >&2; exit 1; }
[ -d "$H" ] || { echo "erro: pasta do Hermes não encontrada: $H" >&2; exit 1; }
# O caminho vai numa URI file:...?mode=ro: recusa caracteres que mudariam o sentido dela.
case "$H" in *'?'* | *'#'* | *'%'*) echo "erro: caminho do Hermes com ?, # ou %: $H" >&2; exit 1 ;; esac

# Só nomes simples de perfil (entram no SQL como literal): letras, números, ponto, hífen e sublinhado.
nome_ok() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }

mkdir -p "$DEST"
chmod 755 "$DEST"
tmp="$(mktemp "$DEST/.uso.jsonl.XXXXXX")"
err="$(mktemp "$DEST/.uso.err.XXXXXX")"
trap 'rm -f -- "$tmp" "$err"' EXIT

agora="${ESCRITORIO_AGORA:-$(date +%s)}" # ESCRITORIO_AGORA (epoch s): só para teste
corte=$((agora - DIAS * 86400))
printf '{"tipo":"meta","gerado_em":%s,"versao":1}\n' "$agora" >"$tmp"

falha() { # <perfil> <mensagem>: só letras/números/pontuação simples, sem aspas
  local msg
  msg="$(printf '%s' "$2" | head -n 1 | tr -cd 'A-Za-z0-9 ._:()/-' | cut -c1-120)"
  printf '{"tipo":"falha","perfil":"%s","erro":"%s"}\n' "$1" "$msg" >>"$tmp"
}

sessao_sql() { # <perfil> <qual> <filtro WHERE>
  printf "SELECT json_object('tipo','sessao','qual','%s','perfil','%s','source',source,'model',model,'started_at',started_at,'ended_at',ended_at,'last_activity_at',last_activity_at) FROM sessions %s ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 1;" "$2" "$1" "$3"
}

copia() { # <perfil> <arquivo state.db>
  local p="$1" db="$2" uri tem sql
  uri="file:$db?mode=ro"
  if ! tem="$("$SQL3" -readonly -batch -noheader "$uri" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session_model_usage';" 2>"$err")"; then
    falha "$p" "$(cat "$err")"
    return
  fi
  if [ "$tem" = "1" ]; then
    sql="SELECT json_object('tipo','uso','perfil','$p','billing_provider',COALESCE(billing_provider,''),'model',COALESCE(model,''),'input_tokens',COALESCE(input_tokens,0),'output_tokens',COALESCE(output_tokens,0),'estimated_cost_usd',COALESCE(estimated_cost_usd,0),'last_seen',last_seen) FROM session_model_usage WHERE last_seen >= $corte;"
  else
    # Banco antigo sem session_model_usage: os totais da própria sessão.
    sql="SELECT json_object('tipo','uso','perfil','$p','billing_provider',COALESCE(billing_provider,''),'model',COALESCE(model,''),'input_tokens',COALESCE(input_tokens,0),'output_tokens',COALESCE(output_tokens,0),'estimated_cost_usd',COALESCE(estimated_cost_usd,0),'last_seen',COALESCE(last_activity_at, started_at)) FROM sessions WHERE COALESCE(last_activity_at, started_at) >= $corte;"
  fi
  sql="$sql $(sessao_sql "$p" ultima '') $(sessao_sql "$p" telegram "WHERE source = 'telegram'")"
  local saida
  if ! saida="$("$SQL3" -readonly -batch -noheader -list "$uri" "$sql" 2>"$err")"; then
    falha "$p" "$(cat "$err")"
    return
  fi
  [ -z "$saida" ] || printf '%s\n' "$saida" >>"$tmp"
}

n=0
if [ -f "$H/state.db" ]; then copia default "$H/state.db"; n=$((n + 1)); fi
for db in "$H"/profiles/*/state.db; do
  [ -f "$db" ] || continue
  p="$(basename "$(dirname "$db")")"
  nome_ok "$p" || { echo "aviso: perfil ignorado (nome estranho): $p" >&2; continue; }
  [ "$p" != default ] || continue
  copia "$p" "$db"
  n=$((n + 1))
done

chmod 644 "$tmp"
mv -f -- "$tmp" "$DEST/uso.jsonl"

# Cota do Antigravity: só as últimas 500 linhas (o leitor usa a última de cada família/janela).
if [ -f "$AGY" ]; then
  tail -n 500 -- "$AGY" >"$err"
  chmod 644 "$err"
  mv -f -- "$err" "$DEST/agy-cota.tsv"
fi

[ "${1:-}" != -v ] || echo "ok: $n banco(s) de sessão -> $DEST/uso.jsonl ($(wc -l <"$DEST/uso.jsonl") linhas)"
