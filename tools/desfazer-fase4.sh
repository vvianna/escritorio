#!/usr/bin/env bash
# desfazer-fase4.sh — desliga o escritório (fase 4 do time-de-agentes, spec D9/D10).
#
#   bash tools/desfazer-fase4.sh            # desliga de verdade
#   DRY=1 bash tools/desfazer-fase4.sh      # só imprime o plano
#
# O escritório é um container à parte: NADA no Hermes muda (nem perfis, nem gateway, nem crons),
# então não há restart de gateway nem guarda de worker do kanban. Passos:
#   1. `docker compose down` na pasta do escritório (container e rede somem; a imagem e o volume
#      /data ficam, para religar com `docker compose up -d --build`);
#   2. confere que nenhum container do projeto ficou de pé;
#   3. "== conferência": `ss -ltn` sem nada escutando na porta (critério do spec: contagem 0).
# Sai 0 só se a conferência passar.
#
# Ambiente: ESCRITORIO_DIR (padrão ~/projetos/escritorio), ESCRITORIO_PORTA (padrão: a do .env da
# pasta, senão 4747), DRY=1, PULAR_HOST=1 (permite rodar fora do gargantua — só para teste).
set -euo pipefail

DIR="${ESCRITORIO_DIR:-$HOME/projetos/escritorio}"
DRY="${DRY:-0}"

if [[ "${PULAR_HOST:-0}" != "1" && "$(hostname)" != "gargantua" ]]; then
  echo "rode no gargantua (ou PULAR_HOST=1 para teste)" >&2
  exit 1
fi
[[ -f "$DIR/docker-compose.yml" ]] || { echo "não achei $DIR/docker-compose.yml (defina ESCRITORIO_DIR)" >&2; exit 2; }

PORTA="${ESCRITORIO_PORTA:-}"
if [[ -z "$PORTA" && -f "$DIR/.env" ]]; then
  # Só a linha da porta; o resto do .env não é lido nem impresso.
  PORTA="$(grep -E '^(ESCRITORIO_PORTA|HABBLAUD_PORT)=' "$DIR/.env" | head -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi
PORTA="${PORTA:-4747}"
[[ "$PORTA" =~ ^[0-9]{1,5}$ ]] || { echo "porta inválida: $PORTA" >&2; exit 2; }

escutando() { ss -ltn | awk 'NR>1 {print $4}' | grep -cE "[:.]${PORTA}\$" || true; }

if [[ "$DRY" == "1" ]]; then
  echo "== plano (DRY=1, nada é executado)"
  echo "1. cd $DIR && docker compose down"
  echo "2. docker compose ps -q → vazio"
  echo "3. conferência: ss -ltn com ':$PORTA' → 0 (agora: $(escutando))"
  echo "Hermes: nada muda."
  exit 0
fi

echo "== 1. docker compose down ($DIR)"
(cd "$DIR" && docker compose down)

echo "== 2. containers do projeto"
RESTO="$(cd "$DIR" && docker compose ps -q || true)"
[[ -z "$RESTO" ]] && echo "nenhum" || echo "ainda de pé: $RESTO"

echo "== conferência"
FALHOU=0
N="$(escutando)"
if [[ "$N" == "0" ]]; then
  echo "ok  porta $PORTA fechada (ss -ltn: 0)"
else
  echo "ERRO porta $PORTA ainda escutando (ss -ltn: $N)"
  FALHOU=1
fi
if [[ -z "$RESTO" ]]; then
  echo "ok  nenhum container do escritório"
else
  echo "ERRO container do escritório ainda de pé"
  FALHOU=1
fi
echo "ok  Hermes não foi tocado"
if [[ "$FALHOU" == "0" ]]; then
  echo "DESFAZER_FASE4_OK"
  echo "Para religar: cd $DIR && docker compose up -d --build"
fi
exit "$FALHOU"
