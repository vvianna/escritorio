#!/usr/bin/env python3
"""Gera diários diários dos perfis Hermes lendo só os kanban.db.

Uso:
  diario_kanban.py --root ~/.hermes --date 2026-10-13

Saída padrão: ~/.local/state/time/diarios/AAAA-MM-DD/<perfil>.md
Sem chamada de modelo/IA: o texto é montado com contagens e títulos dos cartões.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

OPEN_STATUSES = {"ready", "running", "blocked", "review", "todo", "triage", "scheduled"}
PROFILE_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
PR_RE = re.compile(r"\bPR\s*#?\d+|https://github\.com/\S+/pull/\d+", re.I)


@dataclass
class CardLine:
    board: str
    task_id: str
    title: str
    detail: str = ""


@dataclass
class ProfileDay:
    completed: list[CardLine] = field(default_factory=list)
    returned: list[CardLine] = field(default_factory=list)
    blocked: list[CardLine] = field(default_factory=list)
    errors: list[CardLine] = field(default_factory=list)
    prs: set[str] = field(default_factory=set)
    runs: int = 0
    cards: set[str] = field(default_factory=set)


def local_day_bounds(day: dt.date) -> tuple[int, int]:
    start = dt.datetime.combine(day, dt.time.min).astimezone()
    end = start + dt.timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def parse_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def one_line(text: str | None, limit: int = 180) -> str:
    clean = re.sub(r"\s+", " ", (text or "").replace("\\n", "\n")).strip()
    if clean.lower().startswith("o que travou:"):
        clean = clean.split(":", 1)[1].strip()
    return clean[: limit - 1] + "…" if len(clean) > limit else clean


def discover_boards(root: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    main = root / "kanban.db"
    if main.exists():
        out.append(("default", main))
    boards = root / "kanban" / "boards"
    if boards.exists():
        for child in sorted(boards.iterdir()):
            db = child / "kanban.db"
            if db.exists():
                out.append((child.name, db))
    return out


def open_db(path: Path) -> sqlite3.Connection:
    uri = path.resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def task_map(con: sqlite3.Connection, ids: Iterable[str]) -> dict[str, sqlite3.Row]:
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = con.execute(f"SELECT id,title,assignee,status,result,last_failure_error FROM tasks WHERE id IN ({marks})", ids).fetchall()
    return {r["id"]: r for r in rows}


def add_card(day: ProfileDay, kind: str, board: str, task: sqlite3.Row | None, task_id: str, detail: str = "") -> None:
    title = task["title"] if task is not None else task_id
    line = CardLine(board, task_id, title, detail)
    getattr(day, kind).append(line)
    day.cards.add(f"{board}:{task_id}")


def profile_from_event(kind: str, payload: dict[str, Any], task: sqlite3.Row | None) -> str | None:
    for key in ("profile", "assignee", "implementer", "from", "reviewer"):
        value = payload.get(key)
        if isinstance(value, str) and PROFILE_RE.match(value):
            return value
    if task is not None and isinstance(task["assignee"], str) and PROFILE_RE.match(task["assignee"]):
        return task["assignee"]
    return None


def collect_board(board: str, db_path: Path, start: int, end: int, days: dict[str, ProfileDay]) -> None:
    try:
        con = open_db(db_path)
    except Exception as exc:
        days.setdefault("sistema", ProfileDay()).errors.append(CardLine(board, "kanban.db", "Falha ao abrir board", str(exc)))
        return
    try:
        events = con.execute(
            "SELECT task_id,run_id,kind,payload,created_at FROM task_events WHERE created_at>=? AND created_at<? ORDER BY created_at,id",
            (start, end),
        ).fetchall()
        tasks = task_map(con, [e["task_id"] for e in events])
        for e in events:
            payload = parse_payload(e["payload"])
            task = tasks.get(e["task_id"])
            profile = profile_from_event(e["kind"], payload, task)
            if not profile:
                continue
            day = days.setdefault(profile, ProfileDay())
            day.cards.add(f"{board}:{e['task_id']}")
            text = json.dumps(payload, ensure_ascii=False)
            for pr in PR_RE.findall(text):
                day.prs.add(pr)
            kind = e["kind"]
            if kind in {"completed", "done"}:
                add_card(day, "completed", board, task, e["task_id"], one_line(str(payload.get("summary") or payload.get("result") or "")))
            elif kind in {"request_changes", "changes_requested"}:
                add_card(day, "returned", board, task, e["task_id"], one_line(str(payload.get("reason") or payload.get("summary") or "")))
            elif kind in {"blocked", "gave_up", "spawn_failed", "crashed", "timed_out"}:
                reason = payload.get("reason") or payload.get("error") or payload.get("message") or (task["last_failure_error"] if task is not None else "")
                add_card(day, "blocked" if kind == "blocked" else "errors", board, task, e["task_id"], one_line(str(reason or "")))
            elif kind in {"failed", "respawn_guarded"}:
                add_card(day, "errors", board, task, e["task_id"], one_line(text))

        runs = con.execute(
            "SELECT task_id,profile,outcome,summary,error,metadata FROM task_runs WHERE started_at>=? AND started_at<?",
            (start, end),
        ).fetchall()
        tasks = task_map(con, [r["task_id"] for r in runs])
        for r in runs:
            profile = r["profile"]
            if not isinstance(profile, str) or not PROFILE_RE.match(profile):
                continue
            day = days.setdefault(profile, ProfileDay())
            day.runs += 1
            day.cards.add(f"{board}:{r['task_id']}")
            for source in (r["summary"], r["metadata"], r["error"]):
                if source:
                    for pr in PR_RE.findall(str(source)):
                        day.prs.add(pr)
            if r["outcome"] == "completed":
                add_card(day, "completed", board, tasks.get(r["task_id"]), r["task_id"], one_line(r["summary"]))
            elif r["outcome"] in {"request_changes", "blocked"}:
                add_card(day, "returned", board, tasks.get(r["task_id"]), r["task_id"], one_line(r["summary"] or r["error"]))
            elif r["outcome"] and r["outcome"] != "completed":
                add_card(day, "errors", board, tasks.get(r["task_id"]), r["task_id"], one_line(r["error"] or r["summary"]))
    finally:
        con.close()


def lines_for(title: str, items: list[CardLine]) -> list[str]:
    out = [f"## {title}"]
    if not items:
        out.append("- Nenhum.")
        return out
    seen: set[str] = set()
    for item in items:
        key = f"{item.board}:{item.task_id}:{item.detail}"
        if key in seen:
            continue
        seen.add(key)
        detail = f" — {item.detail}" if item.detail else ""
        out.append(f"- {item.board}:{item.task_id} — {item.title}{detail}")
    return out


def render(profile: str, day: dt.date, data: ProfileDay) -> str:
    out = [f"# Diário de {profile} — {day.isoformat()}", "", "Gerado sem IA, a partir dos bancos kanban do Hermes.", ""]
    out.append(
        f"Resumo: {len(data.cards)} cartões tocados; {len(data.completed)} entregas; {len(data.returned)} devolvidos; "
        f"{len(data.blocked)} travados; {len(data.errors)} erros/crashes; {len(data.prs)} PRs citados; {data.runs} runs iniciados."
    )
    out.append("")
    for title, items in [
        ("Entregues", data.completed),
        ("Devolvidos", data.returned),
        ("Travados", data.blocked),
        ("Erros/crash", data.errors),
    ]:
        out.extend(lines_for(title, items))
        out.append("")
    out.append("## PRs citados")
    if data.prs:
        out.extend(f"- {pr}" for pr in sorted(data.prs))
    else:
        out.append("- Nenhum.")
    out.append("")
    return "\n".join(out)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--root", default=os.path.expanduser("~/.hermes"))
    p.add_argument("--date", default=dt.date.today().isoformat(), help="AAAA-MM-DD")
    p.add_argument("--out", default=os.path.expanduser("~/.local/state/time/diarios"))
    args = p.parse_args()
    day = dt.date.fromisoformat(args.date)
    start, end = local_day_bounds(day)
    days: dict[str, ProfileDay] = {}
    for board, db in discover_boards(Path(args.root).expanduser()):
        collect_board(board, db, start, end, days)
    out_dir = Path(args.out).expanduser() / day.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    for profile, data in sorted(days.items()):
        if not data.cards and not data.errors:
            continue
        (out_dir / f"{profile}.md").write_text(render(profile, day, data), encoding="utf-8")
    print(f"diários: {len(days)} perfis em {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
