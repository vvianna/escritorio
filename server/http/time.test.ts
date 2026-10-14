import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { esperandoVictor, readDiarios } from './time';

function makeBoard(root: string, board: string): DatabaseSync {
  const dir = join(root, 'kanban', 'boards', board);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'kanban.db'));
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      assignee TEXT,
      status TEXT,
      block_kind TEXT,
      last_failure_error TEXT,
      created_at INTEGER
    );
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      kind TEXT,
      payload TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

describe('rotas do time de agentes', () => {
  let tmp: ReturnType<typeof tempDir> | undefined;

  afterEach(() => {
    tmp?.cleanup();
    tmp = undefined;
  });

  it('lê diários dos 7 dias anteriores sem subtrair milissegundos fixos', () => {
    tmp = tempDir('habblaud-time-');
    const dir = join(tmp.dir, '.local', 'state', 'time', 'diarios', '2026-10-12');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'devcodex.md'), '# Diário antigo\n');

    expect(readDiarios(tmp.dir, 'devcodex', '2026-10-13', 8)).toEqual([{ date: '2026-10-12', profile: 'devcodex', text: '# Diário antigo\n' }]);
    expect(readDiarios(tmp.dir, '../segredo', '2026-10-13', 8)).toEqual([]);
  });

  it('conta pendências abertas e só portões estruturados bloqueados para o Victor', () => {
    tmp = tempDir('habblaud-time-');

    const pendencias = makeBoard(tmp.dir, 'pendencias');
    pendencias
      .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)')
      .run('p_1', 'Comprar domínio', 'default', 'ready', null, null, 3);
    pendencias
      .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)')
      .run('p_2', 'Pendência fechada', 'default', 'done', null, null, 2);
    pendencias.close();

    const lab = makeBoard(tmp.dir, 'hermes-lab');
    lab.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)').run('t_false', 'contador esperando o Victor', 'dev', 'running', null, null, 5);
    lab.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)').run('t_pr', 'PR #25 em revisão', 'reviewer', 'review', null, null, 4);
    lab.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)').run('t_gate', 'Aprovação manual', 'dev', 'blocked', 'needs_input', null, 3);
    lab
      .prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES (?,?,?,?)')
      .run('t_gate', 'blocked', '{"reason":"O que travou: Victor precisa tocar Allow Once"}', 3);
    lab.close();

    const res = esperandoVictor(tmp.dir);
    expect(res.total).toBe(2);
    expect(res.pendencias).toBe(1);
    expect(res.portoes).toBe(1);
    expect(res.items.map((i) => i.taskId).sort()).toEqual(['p_1', 't_gate']);
    expect(res.items.find((i) => i.taskId === 't_gate')?.reason).toBe('Victor precisa tocar Allow Once');
  });
});
