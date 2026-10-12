#!/usr/bin/env bash
# Copia SÓ METADADO de uso dos bancos de sessão do Hermes para ~/.cache/escritorio/uso.jsonl (roda no HOST).
# Também grava ~/.cache/escritorio/cadeiras.jsonl (provedor/modelo ao vivo de cada cadeira; ver a seção "Cadeiras").
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

# ---------------------------------------------------------------------------------------------------------------------
# Cadeiras: provedor/modelo AO VIVO de cada trabalhador (server/sources/hermes-cadeira.ts) -> $DEST/cadeiras.jsonl.
#   {"tipo":"meta","gerado_em":<epoch s>,"versao":1}
#   {"tipo":"chamada","perfil":..,"sessao":..,"tarefa":"t_.."|"","model":..,"provider":..,"em":<epoch s>,"chamadas":N,
#    "reserva_de":..,"reserva_para":..,"reserva_motivo":..,"reserva_em":..}   <- últimas 6 h do logs/agent.log do perfil
#   {"tipo":"sessao","perfil":..,"sessao":..,"model":..,"billing_provider":..,"started_at":..}  <- sessões kanban de 24 h
#   {"tipo":"config","perfil":..,"model":..,"provider":..,"fallback":["provedor/modelo",..]}
#   {"tipo":"falha","perfil":..,"erro":..}
# Do log só saem: id da sessão, o id do cartão ("work kanban task t_..": nada mais da mensagem), modelo/provedor de cada
# chamada e a troca para a reserva com um motivo de vocabulário fixo (limite, créditos, demora, erro). Do arquivo de
# configuração do perfil só saem model.default/model.provider e provider/model de cada fallback_providers; qualquer
# outra chave (inclusive as de credencial) é ignorada, e valor com caractere fora de [A-Za-z0-9._:/@-] vira "".
AWK=""
for c in gawk awk; do
  if command -v "$c" >/dev/null 2>&1 && "$c" --version 2>/dev/null | head -n 1 | grep -q 'GNU Awk'; then AWK="$c"; break; fi
done
ctmp="$(mktemp "$DEST/.cadeiras.jsonl.XXXXXX")"
trap 'rm -f -- "$tmp" "$err" "$ctmp"' EXIT
printf '{"tipo":"meta","gerado_em":%s,"versao":1}\n' "$agora" >"$ctmp"
corte_log="$(date -d "@$((agora - 6 * 3600))" '+%Y-%m-%d %H:%M:%S')"
corte_dia=$((agora - 86400))

cfalha() { # <perfil> <mensagem>
  local msg
  msg="$(printf '%s' "$2" | head -n 1 | tr -cd 'A-Za-z0-9 ._:()/-' | cut -c1-120)"
  printf '{"tipo":"falha","perfil":"%s","erro":"%s"}\n' "$1" "$msg" >>"$ctmp"
}

# Últimas chamadas por sessão do agent.log (gawk: match com grupos e mktime na hora local do host, a mesma do log).
CHAMADAS_AWK='
function limpa(v) { return (v ~ /^[A-Za-z0-9._:\/@-]+$/) ? v : "" }
match($0, /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})[,.][0-9]+ [A-Z]+ \[([A-Za-z0-9_]+)\] (.*)$/, m) {
  sid = m[7]; resto = m[8]; ts = m[1] "-" m[2] "-" m[3] " " m[4] ":" m[5] ":" m[6]
  if (!(sid in visto)) ordem[++ns] = sid
  visto[sid] = ts
  if (!(sid in tarefa) && match(resto, /conversation turn: session=[A-Za-z0-9_]+ .*msg=.work kanban task (t_[0-9a-f]+)/, t)) tarefa[sid] = t[1]
  if (match(resto, /API call #([0-9]+): model=([^ ]+) provider=([^ ]+)/, a)) {
    n[sid] = a[1] + 0; modelo[sid] = limpa(a[2]); prov[sid] = limpa(a[3]); em[sid] = mktime(m[1] " " m[2] " " m[3] " " m[4] " " m[5] " " m[6])
    next
  }
  # Motivo da próxima troca: só linhas do laço de chamadas (nunca saída de ferramenta), vocabulário fixo.
  if (resto !~ /^(agent\.conversation_loop|agent\.chat_completion_helpers|run_agent|root): /) next
  if (resto ~ /refused for billing|[Cc]redits|insufficient|payment/) erro[sid] = "créditos"
  else if (resto ~ /(^|[^0-9])429([^0-9]|$)|[Rr]ate.?limit|usage limit|quota|[Tt]oo many requests|overloaded/) erro[sid] = "limite"
  else if (resto ~ /TimeoutError|stale for|timed out/) erro[sid] = "demora"
  else if (resto ~ /API call failed/ && !(sid in erro)) erro[sid] = "erro"
  if (match(resto, /Fallback activated: ([^ ]+) → ([^ ]+) \(([^)]+)\)/, f) || match(resto, /: ([^ ]+) via [^ ]+ refused.* using fallback ([^ ]+) via ([^ .]+)/, f)) {
    rde[sid] = limpa(f[1]); rpara[sid] = limpa(f[2]); rprov[sid] = limpa(f[3])
    rmot[sid] = (sid in erro) ? erro[sid] : "desconhecido"
    rem[sid] = mktime(m[1] " " m[2] " " m[3] " " m[4] " " m[5] " " m[6])
    delete erro[sid]
  }
}
END {
  for (i = 1; i <= ns; i++) {
    sid = ordem[i]
    if (visto[sid] < corte || modelo[sid] == "") continue
    printf "{\"tipo\":\"chamada\",\"perfil\":\"%s\",\"sessao\":\"%s\",\"tarefa\":\"%s\",\"model\":\"%s\",\"provider\":\"%s\",\"em\":%d,\"chamadas\":%d", perfil, sid, tarefa[sid], modelo[sid], prov[sid], em[sid], n[sid]
    if (sid in rem) printf ",\"reserva_de\":\"%s\",\"reserva_para\":\"%s\",\"reserva_provider\":\"%s\",\"reserva_motivo\":\"%s\",\"reserva_em\":%d", rde[sid], rpara[sid], rprov[sid], rmot[sid], rem[sid]
    printf "}\n"
  }
}'

# Só model.default/model.provider e provider/model de cada item de fallback_providers (YAML simples do Hermes).
CONFIG_AWK='
function limpa(v) { sub(/[ \t]+#.*$/, "", v); gsub(/^[ \t\"\x27]+|[ \t\"\x27]+$/, "", v); return (v ~ /^[A-Za-z0-9._:\/@-]+$/) ? v : "" }
function fecha() { if (fp != "" || fm != "") { lista = lista (lista == "" ? "" : ",") "\"" fp "/" fm "\"" }; fp = ""; fm = "" }
/^[^ \t#-]/ { if (sec == "fb") fecha(); sec = "" }
/^model:[ \t]*(#.*)?$/ { sec = "model"; next }
/^model:/ { v = $0; sub(/^model:/, "", v); modelo = limpa(v); next }
/^fallback_providers:[ \t]*(#.*)?$/ { sec = "fb"; next }
sec == "model" && match($0, /^  ([a-z_]+):(.*)$/, k) {
  if (k[1] == "default" || (k[1] == "model" && modelo == "")) modelo = limpa(k[2])
  else if (k[1] == "provider") prov = limpa(k[2])
  next
}
sec == "fb" && /^[ \t]*-/ { fecha(); sub(/-/, " ") }
sec == "fb" && match($0, /^[ \t]+(provider|model):(.*)$/, k) { if (k[1] == "provider") fp = limpa(k[2]); else fm = limpa(k[2]) }
END {
  if (sec == "fb") fecha()
  printf "{\"tipo\":\"config\",\"perfil\":\"%s\",\"model\":\"%s\",\"provider\":\"%s\",\"fallback\":[%s]}\n", perfil, modelo, prov, lista
}'

cadeira() { # <perfil> <pasta do perfil> <state.db>
  local p="$1" dir="$2" db="$3" saida
  if [ -z "$AWK" ]; then cfalha "$p" "gawk nao encontrado"; return; fi
  if [ -f "$dir/logs/agent.log" ]; then
    if ! "$AWK" -v perfil="$p" -v corte="$corte_log" "$CHAMADAS_AWK" "$dir/logs/agent.log" >>"$ctmp" 2>"$err"; then cfalha "$p" "log: $(cat "$err")"; fi
  fi
  if [ -f "$db" ]; then
    if saida="$("$SQL3" -readonly -batch -noheader -list "file:$db?mode=ro" "SELECT json_object('tipo','sessao','perfil','$p','sessao',id,'model',COALESCE(model,''),'billing_provider',COALESCE(billing_provider,''),'started_at',started_at) FROM sessions WHERE source = 'kanban' AND started_at >= $corte_dia ORDER BY started_at;" 2>"$err")"; then
      [ -z "$saida" ] || printf '%s\n' "$saida" >>"$ctmp"
    else
      cfalha "$p" "$(cat "$err")"
    fi
  fi
  if [ -f "$dir/config.yaml" ]; then
    "$AWK" -v perfil="$p" "$CONFIG_AWK" "$dir/config.yaml" >>"$ctmp" 2>"$err" || cfalha "$p" "config: $(cat "$err")"
  fi
}

cadeira default "$H" "$H/state.db"
for dir in "$H"/profiles/*/; do
  dir="${dir%/}"
  p="$(basename "$dir")"
  nome_ok "$p" || continue
  [ "$p" != default ] || continue
  [ -f "$dir/state.db" ] || [ -f "$dir/logs/agent.log" ] || continue
  cadeira "$p" "$dir" "$dir/state.db"
done
chmod 644 "$ctmp"
mv -f -- "$ctmp" "$DEST/cadeiras.jsonl"

# ---------------------------------------------------------------------------------------------------------------------
# Régua: veredito "precisa do Victor?" da fila do Manager (~/.local/state/time/manager-fila*.jsonl) -> $DEST/regua.jsonl.
# Só board, cartão, hash do motivo, destino, categoria, fonte e confiança (ver tools/regua-fila.py e
# server/sources/hermes-regua.ts). Sem python3 ou sem a pasta: não grava (o Escritório usa as regras fixas dele).
FILA="${ESCRITORIO_FILA_DIR:-$HOME/.local/state/time}"
if [ -d "$FILA" ] && command -v python3 >/dev/null 2>&1; then
  python3 "$(dirname -- "$0")/regua-fila.py" "$FILA" "$DEST/regua.jsonl" 2>"$err" || echo "aviso: régua da fila não copiada: $(head -n 1 "$err")" >&2
fi

[ "${1:-}" != -v ] || echo "ok: $n banco(s) de sessão -> $DEST/uso.jsonl ($(wc -l <"$DEST/uso.jsonl") linhas), cadeiras.jsonl ($(wc -l <"$DEST/cadeiras.jsonl") linhas)"
