import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { discoverBoards, firstLine, HermesSource, internalBlock, openReadOnly, pickCards, readBoard } from './hermes';
import { HermesSlots, loadNomes, workerName } from './hermes-vagas';

// Kanban SINTÉTICO, com as colunas do kanban.db do Hermes que a fonte lê (nada vem de um board real).
const SCHEMA = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at INTEGER, current_run_id INTEGER, block_kind TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL,
  payload TEXT, created_at INTEGER NOT NULL);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, profile TEXT, status TEXT NOT NULL,
  last_heartbeat_at INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER);
`;

const NOW = Date.UTC(2026, 9, 11, 21, 0, 0);
const S = Math.floor(NOW / 1000);

interface Task {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  created_at?: number;
  started_at?: number;
  completed_at?: number;
  consecutive_failures?: number;
  last_heartbeat_at?: number;
}

function makeDb(path: string, tasks: Task[], events: Array<[string, string, unknown, number]> = [], wal = false): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  if (wal) db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA);
  const ins = db.prepare(
    'INSERT INTO tasks (id, title, status, assignee, created_at, started_at, completed_at, consecutive_failures, last_heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const t of tasks) {
    ins.run(t.id, t.title, t.status, t.assignee ?? null, t.created_at ?? S - 3600, t.started_at ?? null, t.completed_at ?? null, t.consecutive_failures ?? 0, t.last_heartbeat_at ?? null);
  }
  const ev = db.prepare('INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)');
  for (const [tid, kind, payload, at] of events) ev.run(tid, kind, payload === null ? null : JSON.stringify(payload), at);
  db.close();
}

/** Os 4 estados + um perfil à toa, em dois boards. */
function fixtureRoot(root: string): void {
  makeDb(
    join(root, 'kanban.db'),
    [
      { id: 't_run', title: 'Fonte hermes do escritório', status: 'running', assignee: 'dev', started_at: S - 600, last_heartbeat_at: S - 60 },
      { id: 't_blk', title: 'Desenhar o prédio', status: 'blocked', assignee: 'architect' },
      { id: 't_old', title: 'Prints antigos', status: 'done', assignee: 'qa', completed_at: S - 2 * 86400 },
    ],
    [['t_blk', 'blocked', { reason: 'O que travou: falta escolher a porta.\nVocê faz: responda "4317".', kind: 'needs_input' }, S - 300]],
  );
  const guard = Array.from({ length: 6 }, (_, i) => ['t_grd', 'respawn_guarded', { reason: 'blocker_auth' }, S - 60 * (i + 1)] as [string, string, unknown, number]);
  makeDb(
    join(root, 'kanban', 'boards', 'openhealth', 'kanban.db'),
    [
      { id: 't_grd', title: 'Revisar PR #12', status: 'review', assignee: 'reviewer' },
      { id: 't_dlv', title: 'Tela de exames', status: 'review', assignee: 'judge' },
    ],
    [...guard, ['t_dlv', 'review_requested', { summary: 'pronto', implementer: 'devgemini', reviewer: 'judge' }, S - 60]],
    true,
  );
}

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  setQuiet(true);
  tmp = tempDir();
});
afterEach(() => {
  setQuiet(false);
  tmp.cleanup();
});

describe('readBoard', () => {
  it('acha os boards (default + nomeados)', () => {
    fixtureRoot(tmp.dir);
    expect(discoverBoards(tmp.dir).map((b) => b.board)).toEqual(['default', 'openhealth']);
  });

  it('running, blocked (motivo sem "O que travou"), guarda repetida e entregando', () => {
    fixtureRoot(tmp.dir);
    const cards = discoverBoards(tmp.dir).flatMap((b) => {
      const db = openReadOnly(b.path);
      try {
        return readBoard(db, b.board, NOW).cards;
      } finally {
        db.close();
      }
    });
    const by = pickCards(cards);
    expect(by.get('dev')).toMatchObject({ state: 'running', board: 'default', taskId: 't_run' });
    expect(by.get('architect')).toMatchObject({ state: 'blocked', reason: 'falta escolher a porta.' });
    expect(by.get('reviewer')).toMatchObject({ state: 'guarded', board: 'openhealth', taskId: 't_grd' });
    expect(by.get('reviewer')!.reason).toContain('blocker_auth');
    expect(by.get('devgemini')).toMatchObject({ state: 'delivering', taskId: 't_dlv', reason: 'entregou para judge' });
    expect(by.has('qa')).toBe(false);
  });

  it('placa vermelha: running sem heartbeat >60 min, 3 falhas seguidas, bloqueio por erro do sistema', () => {
    const path = join(tmp.dir, 'kanban.db');
    makeDb(
      path,
      [
        { id: 'a', title: 'parado', status: 'running', assignee: 'p1', started_at: S - 3 * 3600, last_heartbeat_at: S - 2 * 3600 },
        { id: 'b', title: 'falhando', status: 'ready', assignee: 'p2', consecutive_failures: 3 },
        { id: 'c', title: 'caiu', status: 'blocked', assignee: 'p3' },
        { id: 'd', title: 'guarda pouca', status: 'review', assignee: 'p4' },
      ],
      [
        ['c', 'blocked', { reason: 'antes' }, S - 900],
        ['c', 'gave_up', { error: 'x' }, S - 600],
        ...Array.from({ length: 4 }, () => ['d', 'respawn_guarded', { reason: 'active_pr' }, S - 30] as [string, string, unknown, number]),
      ],
    );
    const db = openReadOnly(path);
    const by = pickCards(readBoard(db, 'default', NOW).cards);
    db.close();
    expect(by.get('p1')).toMatchObject({ state: 'guarded' });
    expect(by.get('p1')!.reason).toContain('sem sinal de vida');
    expect(by.get('p2')).toMatchObject({ state: 'guarded', reason: '3 falhas seguidas' });
    expect(by.get('p3')).toMatchObject({ state: 'guarded', reason: 'erro do sistema (gave_up)' });
    expect(by.has('p4')).toBe(false); // 4 guardas em 10 min não bastam
  });

  it('12/10: guarda de PR repetida (active_pr) é "Manager resolvendo" (sem mão) e some quando a guarda é solta', () => {
    const path = join(tmp.dir, 'kanban.db');
    const g = (tid: string, reason = 'active_pr') =>
      Array.from({ length: 6 }, (_, i) => [tid, 'respawn_guarded', { reason }, S - 60 * (i + 2)] as [string, string, unknown, number]);
    makeDb(
      path,
      [
        { id: 'pr', title: 'preso no PR', status: 'ready', assignee: 'p1' },
        { id: 'sol', title: 'solto por reatribuição', status: 'ready', assignee: 'p2' },
        { id: 'spw', title: 'solto: worker nasceu', status: 'ready', assignee: 'p3' },
        { id: 'velho', title: 'reatribuído antes da última guarda', status: 'ready', assignee: 'p4' },
        { id: 'aut', title: 'outro motivo', status: 'ready', assignee: 'p5' },
      ],
      [
        ...g('pr'),
        ...g('sol'),
        ['sol', 'assigned', { assignee: 'p2', from: null }, S - 60],
        ...g('spw'),
        ['spw', 'spawned', { pid: 1 }, S - 30],
        ['velho', 'assigned', { assignee: 'p4', from: 'dev' }, S - 600],
        ...g('velho'),
        ...g('aut', 'blocker_auth'),
      ],
    );
    const db = openReadOnly(path);
    const by = pickCards(readBoard(db, 'default', NOW).cards);
    db.close();
    expect(by.get('p1')).toMatchObject({ state: 'internal', taskId: 'pr' });
    expect(by.get('p1')!.reason).toContain('active_pr');
    expect(by.has('p2')).toBe(false);
    expect(by.has('p3')).toBe(false);
    expect(by.get('p4')).toMatchObject({ state: 'internal', taskId: 'velho' });
    expect(by.get('p5')).toMatchObject({ state: 'guarded' });
    expect(by.get('p5')!.reason).toContain('blocker_auth');
  });

  it('entrega antiga (> 3 min) não conta; reatribuição para o revisor conta para quem entregou', () => {
    const path = join(tmp.dir, 'kanban.db');
    makeDb(
      path,
      [{ id: 'x', title: 'cartão', status: 'review', assignee: 'qa' }],
      [
        ['x', 'review_requested', { implementer: 'velho', reviewer: 'reviewer' }, S - 600],
        ['x', 'assigned', { assignee: 'qa', from: 'dev' }, S - 30],
      ],
    );
    const db = openReadOnly(path);
    const by = pickCards(readBoard(db, 'default', NOW).cards);
    db.close();
    expect(by.has('velho')).toBe(false);
    expect(by.get('dev')).toMatchObject({ state: 'delivering', reason: 'entregou para qa' });
  });

  it('abre só para leitura, inclusive WAL com -shm sem permissão de escrita', () => {
    fixtureRoot(tmp.dir);
    const path = join(tmp.dir, 'kanban', 'boards', 'openhealth', 'kanban.db');
    // deixa os arquivos como no container (:ro)
    const keep = new DatabaseSync(path);
    keep.exec('SELECT 1');
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        chmodSync(f, 0o444);
      } catch {
        // -wal/-shm podem não existir
      }
    }
    const db = openReadOnly(path);
    try {
      expect(readBoard(db, 'openhealth', NOW).cards.length).toBeGreaterThan(0);
      expect(() => db.exec("UPDATE tasks SET title='x'")).toThrow();
    } finally {
      db.close();
      keep.close();
    }
  });

  it('abre WAL sem -shm numa pasta só leitura (montagem :ro da pasta kanban/)', () => {
    fixtureRoot(tmp.dir);
    const dir = join(tmp.dir, 'kanban', 'boards', 'openhealth');
    const path = join(dir, 'kanban.db');
    const w = new DatabaseSync(path);
    w.exec('PRAGMA journal_mode=WAL');
    w.close(); // último a fechar: aplica e apaga -wal/-shm
    chmodSync(path, 0o444);
    chmodSync(dir, 0o555);
    try {
      const db = openReadOnly(path);
      try {
        expect(readBoard(db, 'openhealth', NOW).cards.length).toBeGreaterThan(0);
        expect(() => db.exec("UPDATE tasks SET title='x'")).toThrow();
      } finally {
        db.close();
      }
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('bloqueio interno (mesma regra do kanban-nanny) = placa amarela "Manager resolvendo", sem mão', () => {
    const path = join(tmp.dir, 'kanban', 'boards', 'hermes-lab', 'kanban.db');
    const reasons: Record<string, string> = {
      // o caso que o Victor viu
      conflito:
        'O que travou: o PR #38 (feat/x) está com conflito com a main e quem resolve é o dev.\nVocê faz: nada.',
      merge: 'O que travou: PR #12 aprovado, falta mergear o PR #12.\nVocê faz: nada, o opens-automerge mergeia.',
      reatribui: 'O que travou: judge pediu mudança e o cartão caiu no reviewer.\nVocê faz: reatribua o cartão ao dev.',
      correcao: 'A correção é do dev; o reviewer não escreve código.',
      soul: 'Não consigo gravar SOUL.md. Salvei SOUL.md.proposto em docs/.',
      tag: 'O que travou: aguardando a tag v1.2.0 sair para publicar.',
      humano: 'O que travou: falta a senha do banco.\nVocê faz: mande "senha ok" ao Hermes.',
    };
    const tasks = Object.keys(reasons).map((k) => ({ id: `t_${k}`, title: `cartão ${k}`, status: 'blocked', assignee: `p_${k}` }));
    makeDb(
      path,
      tasks,
      Object.entries(reasons).map(([k, reason]) => [`t_${k}`, 'blocked', { reason }, S - 120] as [string, string, unknown, number]),
    );
    const db = openReadOnly(path);
    const by = pickCards(readBoard(db, 'hermes-lab', NOW).cards);
    db.close();
    for (const k of ['conflito', 'merge', 'reatribui', 'correcao', 'soul', 'tag']) expect(by.get(`p_${k}`), k).toMatchObject({ state: 'internal' });
    expect(by.get('p_conflito')!.reason).toBe('conflito com a main');
    expect(by.get('p_humano')).toMatchObject({ state: 'blocked', reason: 'falta a senha do banco.' });
  });

  it('internalBlock: PR esperando merge só é interno nos boards do automerge (como no nanny)', () => {
    const r = 'O que travou: falta mergear o PR #7.\nVocê faz: clique em Merge.';
    expect(internalBlock('openfinance', r)).toBe('PR aprovado esperando merge');
    expect(internalBlock('default', r)).toBeUndefined();
    expect(internalBlock('default', undefined)).toBeUndefined();
    expect(internalBlock('default', 'O que travou: conflito com a origin/main no PR #3')).toBe('conflito com a main');
    expect(internalBlock('default', 'O que travou: preciso que você escolha a cor.')).toBeUndefined();
  });

  it('firstLine corta o rótulo e a linha', () => {
    expect(firstLine('O que travou: a porta.\nVocê faz: x')).toBe('a porta.');
    expect(firstLine('\n\n  só isto ')).toBe('só isto');
    expect(firstLine(undefined)).toBeUndefined();
  });
});

describe('HermesSource no escritório', () => {
  function makeOffice(): Office {
    return new Office({
      names: new NameStore(null),
      version: '9.9.9',
      startedAt: NOW,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
      now: () => NOW,
    });
  }

  it('um personagem por perfil, na sala do board, com o estado do cartão; some quando não tem mais nada', () => {
    fixtureRoot(tmp.dir);
    const office = makeOffice();
    const src = new HermesSource({ office, root: tmp.dir, now: () => NOW });
    src.poll();
    const byName = new Map(office.list().map((a) => [a.name, a]));
    // Cartão running vira trabalhador (sem nomes.json: "dev #1"); o personagem da função não fica à toa ao lado.
    expect(byName.get('dev #1')).toMatchObject({ provider: 'hermes', status: 'working', title: 'Fonte hermes do escritório', hermes: { state: 'running' } });
    expect(byName.get('dev #1')).toMatchObject({ hermesProfile: 'dev', hermesSlot: 1 });
    expect(byName.has('dev')).toBe(false);
    expect(byName.get('architect')).toMatchObject({ status: 'waiting', waitingFor: 'falta escolher a porta.', hermes: { state: 'blocked' } });
    expect(byName.get('reviewer')).toMatchObject({ status: 'waiting', hermes: { state: 'guarded', board: 'openhealth' } });
    expect(byName.get('devgemini')).toMatchObject({ status: 'working', hermes: { state: 'delivering' } });
    expect(byName.get('qa')).toMatchObject({ status: 'idle' });
    expect(byName.get('qa')!.hermes).toBeUndefined();
    expect(office.roomName(byName.get('reviewer')!.roomId)).toBe('openhealth');
    expect(src.sources().map((s) => [s.label, s.sessions, s.ok])).toEqual([
      ['default', 3, true],
      ['openhealth', 3, true],
    ]);
    expect(byName.get('judge')).toMatchObject({ status: 'idle' });

    // Tudo some do kanban: os personagens saem.
    rmSync(join(tmp.dir, 'kanban.db'));
    rmSync(join(tmp.dir, 'kanban'), { recursive: true });
    src.poll();
    expect(office.list().every((a) => a.status === 'offline')).toBe(true);
  });

  it('bloqueio interno: personagem trabalhando (sem mão), atividade "Manager resolvendo"', () => {
    makeDb(
      join(tmp.dir, 'kanban', 'boards', 'hermes-lab', 'kanban.db'),
      [{ id: 't_pr', title: 'PR #38', status: 'blocked', assignee: 'reviewer' }],
      [['t_pr', 'blocked', { reason: 'O que travou: o PR #38 está com conflito; quem resolve é o dev.' }, S - 60]],
    );
    const office = makeOffice();
    new HermesSource({ office, root: tmp.dir, now: () => NOW }).poll();
    const a = office.list().find((x) => x.name === 'reviewer')!;
    expect(a).toMatchObject({ status: 'working', hermes: { state: 'internal', reason: 'conflito com a main' } });
    expect(a.waitingFor).toBeUndefined();
    expect(a.activity?.text).toMatch(/^Manager resolvendo/);
  });

  it('destravado (blocked → reatribuído a outro → running): a mão do anterior abaixa e o ✋ vira "✅ resolvido"', () => {
    const path = join(tmp.dir, 'kanban', 'boards', 'time', 'kanban.db');
    makeDb(
      path,
      [
        { id: 't_34', title: 'time-de-agentes 3.4', status: 'blocked', assignee: 'reviewer' },
        { id: 't_vel', title: 'cartão velho', status: 'done', assignee: 'reviewer', completed_at: S - 86400 },
        { id: 't_out', title: 'outro do judge', status: 'blocked', assignee: 'judge' },
        { id: 't_prx', title: 'próximo do judge', status: 'running', assignee: 'judge', started_at: S - 600, last_heartbeat_at: S - 30 },
      ],
      [
        ['t_34', 'blocked', { reason: 'O que travou: preciso que você escolha o modelo.' }, S - 420],
        ['t_out', 'blocked', { reason: 'O que travou: falta a senha do banco.' }, S - 400],
      ],
    );
    let now = NOW;
    const office = new Office({
      names: new NameStore(null),
      version: '9.9.9',
      startedAt: NOW,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
      now: () => now,
    });
    const src = new HermesSource({ office, root: tmp.dir, now: () => now });
    src.poll();
    const agent = (name: string) => office.list().find((a) => a.name === name)!;
    expect(agent('reviewer')).toMatchObject({ status: 'waiting', hermes: { state: 'blocked', taskId: 't_34' } });
    expect(agent('reviewer').activity?.text).toMatch(/^Precisa de você/);
    expect(agent('judge')).toMatchObject({ status: 'waiting', hermes: { taskId: 't_out' } });

    // O Manager reatribui o cartão ao devcodex, desbloqueia e o devcodex pega; o do judge também é destravado.
    const w = new DatabaseSync(path);
    w.exec(`UPDATE tasks SET assignee='devcodex', status='running', started_at=${S + 60}, last_heartbeat_at=${S + 90} WHERE id='t_34'`);
    w.exec(`UPDATE tasks SET status='ready' WHERE id='t_out'`);
    w.prepare('INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)').run('t_34', 'assigned', JSON.stringify({ assignee: 'devcodex', from: 'reviewer' }), S + 30);
    w.close();
    now = NOW + 120_000;
    src.poll();

    const rev = agent('reviewer');
    expect(rev.status).toBe('idle'); // à toa: sem mão, sem cartão
    expect(rev.waitingFor).toBeUndefined();
    expect(rev.hermes).toBeUndefined();
    expect(rev.activity).toMatchObject({ icon: '✅', kind: 'done', text: 'Resolvido pelo Manager: time-de-agentes 3.4' });
    expect(rev.activity!.detail).toContain('era: Precisa de você');
    expect(rev.recent.some((a) => /^Precisa de você/.test(a.text))).toBe(false);
    expect(office.recentFeed(50).filter((f) => f.agentId === rev.id).map((f) => f.activity.text)).toContain('Resolvido pelo Manager: time-de-agentes 3.4');
    expect(agent('devcodex #1')).toMatchObject({ status: 'working', hermes: { state: 'running', taskId: 't_34' } });

    // O judge tem um trabalhador rodando outro cartão: o personagem da função sai, com o ✋ antigo marcado como
    // resolvido no histórico; o trabalhador segue no cartão dele.
    const judge = agent('judge');
    expect(judge.status).toBe('offline');
    expect(judge.recent.find((a) => a.id.includes(':t_out:blocked:'))).toMatchObject({ icon: '✅', text: 'Resolvido pelo Manager: outro do judge' });
    expect(agent('judge #1')).toMatchObject({ status: 'working', hermes: { state: 'running', taskId: 't_prx' } });
    expect(agent('judge #1').activity?.text).toMatch(/^Trabalhando/);

    // Ciclo seguinte sem mudança: nada é reescrito de novo.
    src.poll();
    expect(agent('reviewer').activity?.text).toBe('Resolvido pelo Manager: time-de-agentes 3.4');
  });

  it('GET /api/snapshot mostra os 4 estados', async () => {
    fixtureRoot(tmp.dir);
    const office = new Office({
      names: new NameStore(null),
      version: '9.9.9',
      startedAt: Date.now(),
      accounts: () => [],
      sources: () => src.sources(),
      accountName: () => undefined,
    });
    const src = new HermesSource({ office, root: tmp.dir, now: () => NOW });
    src.poll();
    const hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => office.markDirty() });
    const api = createApiHandler({ office, hub, accounts, sources: () => src.sources(), version: '9.9.9', inDocker: false });
    const server = http.createServer((req, res) => {
      if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const port = (server.address() as AddressInfo).port;
      const snap = (await (await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json()) as OfficeSnapshot;
      const states = Object.fromEntries(snap.agents.filter((a) => a.hermes).map((a) => [a.name, a.hermes!.state]));
      expect(states).toEqual({ 'dev #1': 'running', architect: 'blocked', reviewer: 'guarded', devgemini: 'delivering' });
      expect(snap.agents.find((a) => a.name === 'dev #1')).toMatchObject({ hermesProfile: 'dev', hermesSlot: 1 });
      expect(snap.rooms.map((r) => r.name).sort()).toEqual(['default', 'openhealth']);
      expect(snap.meta.sources.filter((s) => s.provider === 'hermes').length).toBe(2);
    } finally {
      hub.stop();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

describe('um personagem por trabalhador (modelo 1: nome por vaga)', () => {
  // nomes.json SINTÉTICO, no formato do ~/.hermes/time/nomes.json.
  const NOMES = {
    _comentario: 'teste',
    dev: { tema: 'cientistas', nomes: ['Santos Dumont', 'Oswaldo Cruz', 'Carlos Chagas', 'César Lattes'] },
    default: { tema: 'Manager', nomes: ['Hermes'] },
  };

  function writeNomes(root: string): void {
    mkdirSync(join(root, 'time'), { recursive: true });
    writeFileSync(join(root, 'time', 'nomes.json'), JSON.stringify(NOMES));
  }

  function office(now: () => number = () => NOW): Office {
    return new Office({ names: new NameStore(null), version: '9.9.9', startedAt: NOW, accounts: () => [], sources: () => [], accountName: () => undefined, now });
  }

  const running = (id: string, assignee: string, startedAgo: number): Task => ({
    id,
    title: `cartão ${id}`,
    status: 'running',
    assignee,
    started_at: S - startedAgo,
    last_heartbeat_at: S - 30,
  });

  /** Personagens do Hermes presentes (não offline): nome → cartão. */
  function present(o: Office): Record<string, string | undefined> {
    return Object.fromEntries(
      o
        .list()
        .filter((a) => a.provider === 'hermes' && a.status !== 'offline')
        .map((a) => [a.name, a.hermes?.taskId]),
    );
  }

  it('3 cartões running do dev → 3 nomes diferentes e estáveis; um termina → vaga liberada e reaproveitada', () => {
    writeNomes(tmp.dir);
    const path = join(tmp.dir, 'kanban.db');
    makeDb(path, [running('t_a', 'dev', 900), running('t_b', 'dev', 600), running('t_c', 'dev', 300), { id: 't_d', title: 'próximo', status: 'ready', assignee: 'dev' }]);
    const slotsFile = join(tmp.dir, 'data', 'hermes-vagas.json');
    let now = NOW;
    const o = office(() => now);
    const src = new HermesSource({ office: o, root: tmp.dir, now: () => now, slotsFile });
    src.poll();
    // Quem começou antes pega a vaga mais baixa; o personagem mostra nome (função) + título do cartão.
    expect(present(o)).toEqual({ 'Santos Dumont (dev)': 't_a', 'Oswaldo Cruz (dev)': 't_b', 'Carlos Chagas (dev)': 't_c' });
    const oswaldo = o.list().find((a) => a.name === 'Oswaldo Cruz (dev)')!;
    expect(oswaldo).toMatchObject({ title: 'cartão t_b', status: 'working', hermesProfile: 'dev', hermesSlot: 2, role: 'Trabalhador do Hermes (dev, vaga 2)' });
    expect(JSON.parse(readFileSync(slotsFile, 'utf8'))).toEqual({ version: 1, vagas: { dev: { 'default/t_a': 0, 'default/t_b': 1, 'default/t_c': 2 } } });

    // Ciclos seguintes: ninguém troca de nome.
    now += 5_000;
    src.poll();
    now += 5_000;
    src.poll();
    expect(present(o)).toEqual({ 'Santos Dumont (dev)': 't_a', 'Oswaldo Cruz (dev)': 't_b', 'Carlos Chagas (dev)': 't_c' });

    // O t_a termina: a vaga 1 é liberada e o Santos Dumont sai; os outros mantêm o nome.
    const w = new DatabaseSync(path);
    w.exec(`UPDATE tasks SET status='done', completed_at=${S + 10} WHERE id='t_a'`);
    w.close();
    now += 5_000;
    src.poll();
    expect(present(o)).toEqual({ 'Oswaldo Cruz (dev)': 't_b', 'Carlos Chagas (dev)': 't_c' });
    expect(o.list().find((a) => a.name === 'Santos Dumont (dev)')!.status).toBe('offline');
    expect(JSON.parse(readFileSync(slotsFile, 'utf8')).vagas.dev).toEqual({ 'default/t_b': 1, 'default/t_c': 2 });

    // O t_d começa: pega a 1ª vaga livre (a do Santos Dumont), não a 4ª.
    const w2 = new DatabaseSync(path);
    w2.exec(`UPDATE tasks SET status='running', started_at=${S + 20}, last_heartbeat_at=${S + 20} WHERE id='t_d'`);
    w2.close();
    now += 5_000;
    src.poll();
    expect(present(o)).toEqual({ 'Santos Dumont (dev)': 't_d', 'Oswaldo Cruz (dev)': 't_b', 'Carlos Chagas (dev)': 't_c' });
  });

  it('o mapa cartão → vaga sobrevive a um reinício (lido do /data)', () => {
    writeNomes(tmp.dir);
    makeDb(join(tmp.dir, 'kanban.db'), [running('t_b', 'dev', 600), running('t_c', 'dev', 300)]);
    const slotsFile = join(tmp.dir, 'data', 'hermes-vagas.json');
    mkdirSync(join(tmp.dir, 'data'));
    // Antes do reinício o t_b estava na vaga 3 e o t_c na 1.
    writeFileSync(slotsFile, JSON.stringify({ version: 1, vagas: { dev: { 'default/t_b': 2, 'default/t_c': 0, 'default/t_velho': 1 } } }));
    const o = office();
    new HermesSource({ office: o, root: tmp.dir, now: () => NOW, slotsFile }).poll();
    expect(present(o)).toEqual({ 'Carlos Chagas (dev)': 't_b', 'Santos Dumont (dev)': 't_c' });
    expect(JSON.parse(readFileSync(slotsFile, 'utf8')).vagas.dev).toEqual({ 'default/t_b': 2, 'default/t_c': 0 });
  });

  it('sem nomes.json: "dev #1", "dev #2"; além dos nomes da função, "dev #5"', () => {
    makeDb(join(tmp.dir, 'kanban.db'), [running('t_1', 'dev', 500), running('t_2', 'dev', 400)]);
    const o = office();
    new HermesSource({ office: o, root: tmp.dir, now: () => NOW }).poll();
    expect(present(o)).toEqual({ 'dev #1': 't_1', 'dev #2': 't_2' });

    const nomes = new Map([['dev', ['A', 'B', 'C', 'D']]]);
    expect(workerName('dev', 4, nomes)).toBe('dev #5');
    expect(workerName('dev', 0, nomes)).toBe('A (dev)');
    expect(workerName('qa', 0, nomes)).toBe('qa #1');
  });

  it('personas e o Manager mantêm um personagem só; bloqueio da função segue no personagem da função', () => {
    writeNomes(tmp.dir);
    makeDb(
      join(tmp.dir, 'kanban.db'),
      [
        running('t_m1', 'default', 900),
        { ...running('t_m2', 'default', 100), last_heartbeat_at: S - 5 },
        running('t_v', 'vini', 300),
        running('t_s', 'sergiao', 300),
        running('t_d1', 'dev', 500),
        { id: 't_blk', title: 'precisa de você', status: 'blocked', assignee: 'dev' },
      ],
      [['t_blk', 'blocked', { reason: 'O que travou: falta escolher a cor.' }, S - 60]],
    );
    const o = office();
    new HermesSource({ office: o, root: tmp.dir, now: () => NOW }).poll();
    const p = present(o);
    expect(Object.keys(p).sort()).toEqual(['Hermes (default)', 'Santos Dumont (dev)', 'dev', 'sergiao', 'vini']);
    expect(p['Hermes (default)']).toBe('t_m2'); // um personagem só: o cartão com sinal de vida mais recente, como antes
    expect(p.dev).toBe('t_blk');
    const dev = o.list().find((a) => a.name === 'dev')!;
    expect(dev).toMatchObject({ status: 'waiting', hermesProfile: 'dev' });
    expect(dev.hermesSlot).toBeUndefined();
  });

  it('board ilegível num ciclo: o trabalhador não sai e a vaga não é liberada', () => {
    writeNomes(tmp.dir);
    const path = join(tmp.dir, 'kanban', 'boards', 'openfinance', 'kanban.db');
    makeDb(path, [running('t_x', 'dev', 600), running('t_y', 'dev', 300)]);
    const slotsFile = join(tmp.dir, 'data', 'hermes-vagas.json');
    const o = office();
    const src = new HermesSource({ office: o, root: tmp.dir, now: () => NOW, slotsFile });
    src.poll();
    expect(present(o)).toEqual({ 'Santos Dumont (dev)': 't_x', 'Oswaldo Cruz (dev)': 't_y' });
    writeFileSync(path, 'isto não é um banco sqlite');
    src.poll();
    expect(src.sources()[0]).toMatchObject({ label: 'openfinance', ok: false });
    expect(present(o)).toEqual({ 'Santos Dumont (dev)': 't_x', 'Oswaldo Cruz (dev)': 't_y' });
    expect(JSON.parse(readFileSync(slotsFile, 'utf8')).vagas.dev).toEqual({ 'openfinance/t_x': 0, 'openfinance/t_y': 1 });
  });

  it('loadNomes ignora comentários e entradas sem lista; HermesSlots ignora vaga repetida no arquivo', () => {
    writeNomes(tmp.dir);
    const nomes = loadNomes(join(tmp.dir, 'time', 'nomes.json'));
    expect([...nomes.keys()]).toEqual(['dev', 'default']);
    expect(loadNomes(join(tmp.dir, 'nao-existe.json')).size).toBe(0);
    const file = join(tmp.dir, 'vagas.json');
    writeFileSync(file, JSON.stringify({ version: 1, vagas: { dev: { 'b/1': 0, 'b/2': 0, 'b/3': 'x' } } }));
    const slots = new HermesSlots(file);
    expect(slots.get('dev', 'b', '1')).toBe(0);
    expect(slots.get('dev', 'b', '2')).toBeUndefined();
    slots.sync([
      { profile: 'dev', board: 'b', taskId: '1' },
      { profile: 'dev', board: 'b', taskId: '2' },
    ]);
    expect(slots.get('dev', 'b', '2')).toBe(1);
  });
});
