#!/usr/bin/env python3
"""Copia SÓ o veredito da régua da fila do Manager para o Escritório (roda no HOST, chamado por tools/copiar-uso.sh).

Lê ~/.local/state/time/manager-fila.jsonl e manager-fila.feitos.jsonl (linhas do kanban-nanny / manager-fila, com o
campo `regua` = {destino, categoria, fonte, confianca, porque}; régua única do hermes-lab,
scripts/time/regua_victor.py) e grava <destino>/regua.jsonl, uma linha por item:
  {"tipo":"meta","gerado_em":<epoch s>,"versao":1}
  {"tipo":"regua","board":..,"task":"t_..","motivo":<16 hex do sha256 do motivo>,"destino":"victor"|"manager",
   "categoria":..,"fonte":..,"confianca":<0..1>}
PRIVACIDADE: o motivo, o título, o assignee e o "porque" NÃO saem (o motivo vira só um hash, para o Escritório saber
se o veredito é do bloqueio atual do cartão). Campos com caractere fora do vocabulário viram "" e a linha é descartada.

Uso: regua-fila.py <pasta da fila> <arquivo de saída>
Item sem `regua` (antes de 12/10) é ignorado: o Escritório aplica as regras fixas dele (server/sources/hermes-regua.ts).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

MAX_LINHAS = 2000
BOARD_OK = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
TASK_OK = re.compile(r"^t_[0-9a-f]{4,32}$")
PALAVRA_OK = re.compile(r"^[a-z_]{1,40}$")


def hash_motivo(motivo: str) -> str:
    """Igual a hashMotivo() do Escritório: strip, 3000 caracteres, sha256, 16 hex."""
    return hashlib.sha256(motivo.strip()[:3000].encode("utf-8")).hexdigest()[:16]


def linhas(arq: Path) -> list[str]:
    try:
        with arq.open(encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()[-MAX_LINHAS:]
    except OSError:
        return []


def veredito(bruta: str) -> dict | None:
    try:
        item = json.loads(bruta)
    except ValueError:
        return None
    if not isinstance(item, dict) or not isinstance(item.get("regua"), dict):
        return None
    r = item["regua"]
    board, task, motivo = item.get("board"), item.get("task"), item.get("motivo")
    if not (isinstance(board, str) and BOARD_OK.match(board) and isinstance(task, str) and TASK_OK.match(task)):
        return None
    if not isinstance(motivo, str) or r.get("destino") not in ("victor", "manager"):
        return None
    cat, fonte, conf = r.get("categoria"), r.get("fonte"), r.get("confianca")
    return {
        "tipo": "regua",
        "board": board,
        "task": task,
        "motivo": hash_motivo(motivo),
        "destino": r["destino"],
        "categoria": cat if isinstance(cat, str) and PALAVRA_OK.match(cat) else "",
        "fonte": fonte if isinstance(fonte, str) and PALAVRA_OK.match(fonte) else "",
        "confianca": round(float(conf), 3) if isinstance(conf, (int, float)) and not isinstance(conf, bool) else 0.0,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    pasta, saida = Path(argv[0]), Path(argv[1])
    agora = int(os.environ.get("ESCRITORIO_AGORA") or time.time())
    out = [json.dumps({"tipo": "meta", "gerado_em": agora, "versao": 1})]
    # feitos primeiro, fila (mais nova) depois: no Escritório a última linha do mesmo cartão+motivo vale.
    for nome in ("manager-fila.feitos.jsonl", "manager-fila.jsonl"):
        for bruta in linhas(pasta / nome):
            v = veredito(bruta) if bruta.strip() else None
            if v:
                out.append(json.dumps(v, ensure_ascii=True))
    saida.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".regua.jsonl.", dir=saida.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(out) + "\n")
        os.chmod(tmp, 0o644)
        os.replace(tmp, saida)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
