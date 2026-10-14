#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'deliverables' / 'time-de-agentes' / 'diario_kanban.py'
BASE_TS = int(dt.datetime(2026, 10, 13, 12, 0).astimezone().timestamp())


def make_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(
        '''
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, result TEXT, last_failure_error TEXT
        );
        CREATE TABLE task_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER
        );
        CREATE TABLE task_runs (
          id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT, summary TEXT, metadata TEXT, error TEXT
        );
        '''
    )
    con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)", ('t_1', 'Implementar painel', '', 'dev', 'done', None, None))
    con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)", ('t_2', 'Revisar PR', '', 'reviewer', 'blocked', None, None))
    con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)", ('t_3', 'Devolver ajuste', '', 'reviewer', 'ready', None, None))
    con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)", ('t_4', 'Aguardar janela', '', 'reviewer', 'scheduled', None, None))
    con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)", ('t_5', 'Falhar de verdade', '', 'dev', 'ready', None, None))
    con.execute("INSERT INTO task_events(task_id,run_id,kind,payload,created_at) VALUES (?,?,?,?,?)", ('t_2', None, 'blocked', '{"reason":"O que travou: falta aprovar PR #12"}', BASE_TS))
    con.execute("INSERT INTO task_events(task_id,run_id,kind,payload,created_at) VALUES (?,?,?,?,?)", ('t_1', 1, 'completed', '{"summary":"PR #11 entregue"}', BASE_TS))
    con.execute("INSERT INTO task_events(task_id,run_id,kind,payload,created_at) VALUES (?,?,?,?,?)", ('t_3', 2, 'changes_requested', '{"reason":"corrigir borda"}', BASE_TS))
    con.execute("INSERT INTO task_events(task_id,run_id,kind,payload,created_at) VALUES (?,?,?,?,?)", ('t_4', 3, 'respawn_guarded', '{"reason":"guarda barulhenta"}', BASE_TS))
    con.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?)", (1, 't_1', 'dev', BASE_TS, BASE_TS + 10, 'completed', 'PR #11 aberto', '{}', None))
    con.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?)", (2, 't_3', 'reviewer', BASE_TS, BASE_TS + 10, 'changes_requested', 'corrigir borda', '{}', None))
    con.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?)", (3, 't_4', 'reviewer', BASE_TS, BASE_TS + 10, 'review_requested', 'não é erro', '{}', None))
    con.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?)", (4, 't_5', 'dev', BASE_TS, BASE_TS + 10, 'crashed', None, '{}', 'trace curto'))
    con.commit()
    con.close()


def main() -> int:
    tmp = ROOT / '.tmp-diario-test'
    if tmp.exists():
        for p in sorted(tmp.rglob('*'), reverse=True):
            if p.is_file():
                p.unlink()
            else:
                p.rmdir()
    make_db(tmp / 'kanban' / 'boards' / 'demo' / 'kanban.db')
    out = tmp / 'out'
    res = subprocess.run([sys.executable, str(SCRIPT), '--root', str(tmp), '--date', '2026-10-13', '--out', str(out)], text=True, capture_output=True, check=True)
    dev = out / '2026-10-13' / 'dev.md'
    reviewer = out / '2026-10-13' / 'reviewer.md'
    assert dev.exists(), res.stdout
    assert reviewer.exists(), res.stdout
    dev_text = dev.read_text(encoding='utf-8')
    reviewer_text = reviewer.read_text(encoding='utf-8')
    assert 'Implementar painel' in dev_text
    assert 'PR #11' in dev_text
    assert '1 entregas' in dev_text
    assert 'trace curto' in dev_text
    assert '1 erros/crashes' in dev_text
    assert 'falta aprovar PR #12' in reviewer_text
    assert 'Devolver ajuste' in reviewer_text
    assert 'corrigir borda' in reviewer_text
    assert 'Aguardar janela' not in reviewer_text
    assert 'guarda barulhenta' not in reviewer_text
    assert '1 devolvidos' in reviewer_text
    print('ok diario_kanban')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
