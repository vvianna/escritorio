import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { HermesSource } from './hermes';
import { assinaturaDe, chamadaDoCartao, criarLeitorCadeiras, modeloDaCadeira, nomeModelo, parseCadeiras } from './hermes-cadeira';

setQuiet(true);

// Tudo SINTÉTICO (fixtures): nenhum log, banco ou config real do Hermes.
const NOW = Date.UTC(2026, 9, 11, 23, 0, 0);
const S = Math.floor(NOW / 1000);
const SEGREDO = 'SEGREDO-NAO-PODE-SAIR';

const linha = (o: Record<string, unknown>) => JSON.stringify(o);
const meta = (s = S) => linha({ tipo: 'meta', gerado_em: s, versao: 1 });
const cfg = (perfil: string, model: string, provider: string, fallback: string[] = []) => linha({ tipo: 'config', perfil, model, provider, fallback });
const chamada = (o: Record<string, unknown>) => linha({ tipo: 'chamada', chamadas: 3, em: S - 30, ...o });

describe('cadeiras: nomes e assinaturas', () => {
  it('nome legível do modelo', () => {
    expect(['claude-opus-5-5', 'claude-sonnet-5', 'gpt-5.5', 'gemini-3.1-pro', 'grok-4-fast-reasoning', 'grok-4.7', 'claude-opus-5-5-medium'].map(nomeModelo)).toEqual([
      'Claude Opus 5.5',
      'Claude Sonnet 5',
      'GPT-5.5',
      'Gemini 3.1 Pro',
      'Grok 4 Fast Reasoning',
      'Grok 4.7',
      'Claude Opus 5.5 Medium',
    ]);
  });

  it('assinatura pelo provedor (e pela família no Antigravity)', () => {
    expect(assinaturaDe('anthropic', 'claude-opus-5-5')).toEqual({ assinatura: 'claude', rotulo: 'Claude' });
    expect(assinaturaDe('openai-codex', 'gpt-5.5')).toEqual({ assinatura: 'codex', rotulo: 'Codex' });
    expect(assinaturaDe('antigravity-agy', 'gemini-3.1-pro')).toEqual({ assinatura: 'agy-gemini', rotulo: 'AG Gemini' });
    expect(assinaturaDe('antigravity-agy', 'claude-opus-5-5-medium')).toEqual({ assinatura: 'agy-claude', rotulo: 'AG Claude' });
    expect(assinaturaDe('xai-oauth', 'grok-4.7')).toEqual({ assinatura: 'grok', rotulo: 'Grok' });
    expect(assinaturaDe('sakana', 'fugu-ultra')).toEqual({ assinatura: 'outro', rotulo: 'sakana' });
  });
});

describe('cadeiras: leitura e casamento cartão → sessão', () => {
  it('descarta linhas estranhas e campos fora da lista', () => {
    const d = parseCadeiras(
      [
        meta(),
        'lixo {',
        chamada({ perfil: '../x', sessao: 's1', model: 'm', provider: 'p' }),
        chamada({ perfil: 'dev', sessao: 's"; drop', model: 'm', provider: 'p' }),
        chamada({ perfil: 'dev', sessao: 's2', tarefa: 'não é id', model: 'claude-opus-5-5', provider: 'anthropic', conteudo: SEGREDO }),
        chamada({ perfil: 'dev', sessao: 's3', model: 'gpt 5 <script>', provider: 'x' }),
        linha({ tipo: 'config', perfil: 'judge', model: 'grok-4.7', provider: 'xai-oauth', fallback: ['openai-codex/gpt-5.5', 7, 'a b'], api_key: SEGREDO }),
      ].join('\n'),
    );
    expect(d.copiadoEm).toBe(S * 1000);
    expect(d.chamadas).toEqual([{ perfil: 'dev', sessao: 's2', tarefa: '', model: 'claude-opus-5-5', provider: 'anthropic', em: S - 30, chamadas: 3 }]);
    expect(d.configs.get('judge')).toMatchObject({ model: 'grok-4.7', provider: 'xai-oauth', fallback: ['openai-codex/gpt-5.5'] });
    expect(JSON.stringify([...d.configs.values(), ...d.chamadas])).not.toContain(SEGREDO);
  });

  it('casa pelo id do cartão no log; senão pela sessão kanban que começou logo depois do run', () => {
    const d = parseCadeiras(
      [
        meta(),
        // run anterior do mesmo cartão (outra sessão, antes do run atual): não conta
        chamada({ perfil: 'dev', sessao: 'velha', tarefa: 't_aa', model: 'grok-4.7', provider: 'xai-oauth', em: S - 7200 }),
        chamada({ perfil: 'dev', sessao: 'nova', tarefa: 't_aa', model: 'claude-opus-5-5', provider: 'anthropic', em: S - 20 }),
        chamada({ perfil: 'dev', sessao: 'semtarefa', model: 'gpt-5.5', provider: 'openai-codex', em: S - 10 }),
        linha({ tipo: 'sessao', perfil: 'dev', sessao: 'semtarefa', model: 'claude-opus-5-5', billing_provider: 'anthropic', started_at: S - 590 }),
        linha({ tipo: 'sessao', perfil: 'dev', sessao: 'longe', model: 'x', billing_provider: 'y', started_at: S - 2000 }),
      ].join('\n'),
    );
    expect(chamadaDoCartao(d, 'dev', 't_aa', S - 600).chamada?.sessao).toBe('nova');
    expect(chamadaDoCartao(d, 'dev', 't_aa', S + 100)).toEqual({}); // run novo, ainda sem chamada: não pega a do run anterior
    expect(chamadaDoCartao(d, 'dev', 't_bb', S - 600)).toMatchObject({ chamada: { sessao: 'semtarefa', model: 'gpt-5.5' } });
    expect(chamadaDoCartao(d, 'dev', 't_bb', S - 5000)).toEqual({});
    expect(chamadaDoCartao(d, 'judge', 't_aa', S - 600)).toEqual({});
  });

  it('reserva: pela troca no log (com motivo) ou pelo provedor fora do principal configurado', () => {
    const d = parseCadeiras(
      [
        meta(),
        cfg('dev', 'claude-opus-5-5', 'anthropic', ['antigravity-agy/gemini-3.1-pro']),
        cfg('judge', 'grok-4.7', 'xai-oauth'),
        chamada({
          perfil: 'dev', sessao: 'a', tarefa: 't_01', model: 'gemini-3.1-pro', provider: 'antigravity-agy',
          reserva_de: 'claude-opus-5-5', reserva_para: 'gemini-3.1-pro', reserva_provider: 'antigravity-agy', reserva_motivo: 'limite', reserva_em: S - 60,
        }),
        chamada({ perfil: 'dev', sessao: 'b', tarefa: 't_02', model: 'claude-opus-5-5', provider: 'anthropic' }),
        chamada({ perfil: 'judge', sessao: 'c', tarefa: 't_03', model: 'gpt-5.5', provider: 'openai-codex' }),
      ].join('\n'),
    );
    expect(modeloDaCadeira(d, 'dev', 't_01', S - 600)).toEqual({
      assinatura: 'agy-gemini', rotulo: 'AG Gemini', model: 'gemini-3.1-pro', nome: 'Gemini 3.1 Pro', provider: 'antigravity-agy',
      reserva: true, principal: 'Claude Opus 5.5', motivo: 'limite', em: (S - 30) * 1000, copiadoEm: S * 1000,
    });
    expect(modeloDaCadeira(d, 'dev', 't_02', S - 600)).toMatchObject({ assinatura: 'claude', nome: 'Claude Opus 5.5' });
    expect(modeloDaCadeira(d, 'dev', 't_02', S - 600)?.reserva).toBeUndefined();
    expect(modeloDaCadeira(d, 'judge', 't_03', S - 600)).toMatchObject({ assinatura: 'codex', reserva: true, principal: 'Grok 4.7' });
    expect(modeloDaCadeira(d, 'judge', 't_03', S - 600)?.motivo).toBeUndefined();
  });

  it('leitor relê só quando o arquivo muda; arquivo ausente = vazio', () => {
    const t = tempDir('cadeiras-');
    try {
      const arq = join(t.dir, 'cadeiras.jsonl');
      const ler = criarLeitorCadeiras(arq);
      expect(ler().chamadas).toEqual([]);
      writeFileSync(arq, [meta(), chamada({ perfil: 'dev', sessao: 'a', model: 'gpt-5.5', provider: 'openai-codex' })].join('\n'));
      const a = ler();
      expect(a.chamadas).toHaveLength(1);
      expect(ler()).toBe(a);
      expect(criarLeitorCadeiras(null)().chamadas).toEqual([]);
    } finally {
      t.cleanup();
    }
  });
});

// ------------------------------------------------------------------------------------------- HermesSource no escritório

const SCHEMA = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at INTEGER, current_run_id INTEGER, block_kind TEXT, created_by TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL,
  payload TEXT, created_at INTEGER NOT NULL);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, profile TEXT, status TEXT NOT NULL,
  last_heartbeat_at INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER);
`;

describe('HermesSource: selo de modelo da cadeira e avisos na Atividade', () => {
  let tmp: { dir: string; cleanup: () => void };
  let arq: string;
  beforeEach(() => {
    tmp = tempDir('hermes-cadeira-');
    arq = join(tmp.dir, 'cache', 'cadeiras.jsonl');
    mkdirSync(join(tmp.dir, 'cache'));
    mkdirSync(join(tmp.dir, 'time'));
    writeFileSync(join(tmp.dir, 'time', 'nomes.json'), JSON.stringify({ dev: { nomes: ['Santos Dumont'] } }));
    const db = new DatabaseSync(join(tmp.dir, 'kanban.db'));
    db.exec(SCHEMA);
    db.prepare("INSERT INTO task_runs (id, task_id, profile, status, started_at) VALUES (7, 't_01', 'dev', 'running', ?)").run(S - 600);
    db.prepare(
      "INSERT INTO tasks (id, title, status, assignee, created_at, started_at, last_heartbeat_at, current_run_id) VALUES ('t_01', 'Selo do modelo', 'running', 'dev', ?, ?, ?, 7)",
    ).run(S - 4000, S - 3000, S - 30);
    db.prepare("INSERT INTO tasks (id, title, status, assignee, created_at) VALUES ('t_02', 'Revisar', 'blocked', 'judge', ?)").run(S - 500);
    db.prepare("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_02', 'blocked', ?, ?)").run(JSON.stringify({ reason: 'O que travou: escolha.' }), S - 400);
    db.close();
  });
  afterEach(() => tmp.cleanup());

  function escreve(linhas: string[], mtime: number): void {
    writeFileSync(arq, linhas.join('\n'));
    utimesSync(arq, mtime, mtime); // o leitor relê pelo mtime
  }

  it('selo ao vivo; troca para a reserva vira linha na Atividade; config nova vira ⚙️', () => {
    let now = NOW;
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: NOW, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => now });
    const src = new HermesSource({ office, root: tmp.dir, now: () => now, cadeirasFile: arq });
    const base = [cfg('dev', 'claude-opus-5-5', 'anthropic', ['antigravity-agy/gemini-3.1-pro']), cfg('judge', 'grok-4.7', 'xai-oauth')];
    // run atual começou em S-600: a sessão do log diz o cartão
    escreve([meta(), ...base, chamada({ perfil: 'dev', sessao: 's1', tarefa: 't_01', model: 'claude-opus-5-5', provider: 'anthropic' })], 1000);
    src.poll();
    const dev = () => office.list().find((a) => a.name === 'Santos Dumont (dev)')!;
    expect(dev().hermesModelo).toMatchObject({ assinatura: 'claude', rotulo: 'Claude', nome: 'Claude Opus 5.5', provider: 'anthropic' });
    expect(dev().hermesModelo?.reserva).toBeUndefined();
    expect(dev().model).toBe('claude-opus-5-5');
    // o judge (bloqueado, sem worker) não tem selo
    expect(office.list().find((a) => a.name === 'judge')!.hermesModelo).toBeUndefined();

    // Caiu para a reserva no meio do cartão.
    now = NOW + 120_000;
    escreve(
      [
        meta(S + 120),
        ...base,
        chamada({
          perfil: 'dev', sessao: 's1', tarefa: 't_01', model: 'gemini-3.1-pro', provider: 'antigravity-agy', em: S + 100,
          reserva_de: 'claude-opus-5-5', reserva_para: 'gemini-3.1-pro', reserva_provider: 'antigravity-agy', reserva_motivo: 'limite', reserva_em: S + 90,
        }),
      ],
      2000,
    );
    src.poll();
    expect(dev().hermesModelo).toMatchObject({ assinatura: 'agy-gemini', reserva: true, principal: 'Claude Opus 5.5', motivo: 'limite' });
    const linhaReserva = dev().recent.find((a) => a.icon === '↪');
    expect(linhaReserva?.text).toBe('passou de Claude Opus 5.5 para Gemini 3.1 Pro (reserva) — motivo: limite');
    expect(linhaReserva?.detail).toMatch(/^Santos Dumont \(dev\) passou de Claude Opus 5\.5 para Gemini 3\.1 Pro \(reserva\) — motivo: limite · default · t_01/);
    // a linha não vira o balão do personagem
    expect(dev().activity?.icon).not.toBe('↪');
    // ciclo seguinte sem mudança: não repete
    src.poll();
    expect(dev().recent.filter((a) => a.icon === '↪')).toHaveLength(1);

    // Alguém trocou o modelo principal do judge.
    now = NOW + 240_000;
    escreve(
      [
        meta(S + 240),
        cfg('dev', 'claude-opus-5-5', 'anthropic', ['antigravity-agy/gemini-3.1-pro']),
        cfg('judge', 'gpt-5.5', 'openai-codex'),
        chamada({ perfil: 'dev', sessao: 's1', tarefa: 't_01', model: 'gemini-3.1-pro', provider: 'antigravity-agy', em: S + 100 }),
      ],
      3000,
    );
    src.poll();
    const judge = office.list().find((a) => a.name === 'judge')!;
    expect(judge.recent.find((a) => a.icon === '⚙️')?.text).toBe('judge: modelo principal agora é GPT-5.5');
    // a reserva do dev só mudou de motivo-conhecido para "sem linha de troca": continua reserva, sem linha nova
    expect(dev().recent.filter((a) => a.icon === '↪')).toHaveLength(1);
  });

  it('perfil à toa (ou cartão sem worker) mostra o último modelo usado, marcado ocioso', () => {
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: NOW, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => NOW });
    escreve(
      [
        meta(),
        linha({ tipo: 'sessao', perfil: 'judge', sessao: 'j1', model: 'gpt-5.5', billing_provider: 'openai-codex', started_at: S - 5000 }),
        linha({ tipo: 'sessao', perfil: 'judge', sessao: 'j2', model: 'grok-4.7', billing_provider: '', started_at: S - 2000 }),
        chamada({ perfil: 'judge', sessao: 'j0', model: 'claude-opus-5-5', provider: 'anthropic', em: S - 9000 }),
      ],
      1000,
    );
    new HermesSource({ office, root: tmp.dir, now: () => NOW, cadeirasFile: arq }).poll();
    const judge = office.list().find((a) => a.name === 'judge')!;
    expect(judge.hermesModelo).toMatchObject({ assinatura: 'grok', rotulo: 'Grok', model: 'grok-4.7', nome: 'Grok 4.7', ocioso: true, em: (S - 2000) * 1000 });
    expect(judge.hermesModelo?.reserva).toBeUndefined();
  });

  it('sem cópia (arquivo ausente) não há selo e nada quebra', () => {
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: NOW, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => NOW });
    new HermesSource({ office, root: tmp.dir, now: () => NOW, cadeirasFile: join(tmp.dir, 'nao-existe.jsonl') }).poll();
    expect(office.list().find((a) => a.name === 'Santos Dumont (dev)')!.hermesModelo).toBeUndefined();
  });
});

// --------------------------------------------------------------------------------- tools/copiar-uso.sh -> cadeiras.jsonl

const SCRIPT = resolve(__dirname, '..', '..', 'tools', 'copiar-uso.sh');
const temFerramentas =
  ['/home/linuxbrew/.linuxbrew/bin/sqlite3', '/usr/bin/sqlite3', '/usr/local/bin/sqlite3'].some((c) => existsSync(c)) &&
  spawnSync('sh', ['-c', 'gawk --version || awk --version'], { encoding: 'utf8' }).stdout.includes('GNU Awk');

/** Hora local "YYYY-MM-DD HH:MM:SS,mmm" (o agent.log do Hermes usa a hora local do host). */
function hl(sEpoch: number): string {
  const d = new Date(sEpoch * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())},123`;
}

describe('copiar-uso.sh: cadeiras.jsonl', () => {
  let tmp: { dir: string; cleanup: () => void };
  beforeEach(() => {
    tmp = tempDir('copiar-cadeiras-');
  });
  afterEach(() => tmp.cleanup());

  it.skipIf(!temFerramentas)('só metadado do log e da config; segredos e conteúdo não saem', () => {
    const h = join(tmp.dir, 'hermes');
    const dev = join(h, 'profiles', 'dev');
    mkdirSync(join(dev, 'logs'), { recursive: true });
    const sid = '20261011_224628_de3ae8';
    const outra = '20261011_224700_aaaaaa';
    writeFileSync(
      join(dev, 'logs', 'agent.log'),
      [
        `${hl(S - 300)} INFO [${sid}] agent.turn_context: conversation turn: session=${sid} model=claude-opus-5-5 provider=anthropic platform=cli history=0 msg='work kanban task t_607896d1 ${SEGREDO}'`,
        `${hl(S - 290)} INFO [${sid}] agent.conversation_loop: API call #1: model=claude-opus-5-5 provider=anthropic in=10 out=2 total=12 latency=1.0s`,
        `${hl(S - 280)} WARNING [${sid}] agent.tool_executor: Tool terminal returned error: quota 429 ${SEGREDO}`,
        `${hl(S - 200)} WARNING [${sid}] agent.conversation_loop: API call failed (attempt 1/3) error_type=RateLimitError status=429 thread=Thread-4:1322442997`,
        `${hl(S - 199)} INFO [${sid}] agent.chat_completion_helpers: Fallback activated: claude-opus-5-5 → gemini-3.1-pro (antigravity-agy)`,
        `${hl(S - 150)} INFO [${sid}] agent.conversation_loop: API call #2: model=gemini-3.1-pro provider=antigravity-agy in=10 out=2 total=12 latency=1.0s`,
        `${hl(S - 100)} INFO [${outra}] agent.conversation_loop: API call #1: model=gpt-5.5 provider=openai-codex in=1 out=1`,
        `${hl(S - 9 * 3600)} INFO [antiga_1] agent.conversation_loop: API call #9: model=grok-4.7 provider=xai-oauth in=1 out=1`,
        `${hl(S - 50)} INFO tools.environments.base: Session snapshot created (session=29d8e7, cwd=/home/x/${SEGREDO})`,
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(dev, 'config.yaml'),
      [
        'model:',
        '  default: claude-opus-5-5',
        '  provider: anthropic',
        `  api_key: ${SEGREDO}`,
        '  base_url: https://exemplo.invalid',
        'providers:',
        '  sakana:',
        `    key: ${SEGREDO}`,
        '    default_model: fugu-ultra',
        'fallback_providers:',
        '  - provider: antigravity-agy',
        '    model: gemini-3.1-pro',
        `    api_key: ${SEGREDO}`,
        '  - provider: openai-codex # comentário',
        '    model: "gpt-5.5"',
        'cron:',
        '  model: claude-sonnet-5',
        '  model_provider: anthropic',
      ].join('\n') + '\n',
    );
    writeFileSync(join(dev, '.env'), SEGREDO);
    const db = new DatabaseSync(join(dev, 'state.db'));
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, system_prompt TEXT,
      started_at REAL NOT NULL, ended_at REAL, billing_provider TEXT, last_activity_at REAL, cwd TEXT)`);
    const ins = db.prepare('INSERT INTO sessions (id, source, user_id, model, system_prompt, started_at, billing_provider, cwd) VALUES (?,?,?,?,?,?,?,?)');
    ins.run(sid, 'kanban', SEGREDO, 'claude-opus-5-5', SEGREDO, S - 305, 'anthropic', SEGREDO);
    ins.run('tg_1', 'telegram', SEGREDO, 'claude-opus-5-5', SEGREDO, S - 100, 'anthropic', SEGREDO);
    ins.run('velha', 'kanban', SEGREDO, 'claude-opus-5-5', SEGREDO, S - 3 * 86400, 'anthropic', SEGREDO);
    db.close();

    const cache = join(tmp.dir, 'cache');
    execFileSync('bash', [SCRIPT], {
      env: { ...process.env, ESCRITORIO_HERMES_DIR: h, ESCRITORIO_CACHE_DIR: cache, ESCRITORIO_AGY_COTA: join(tmp.dir, 'nao-existe.tsv'), ESCRITORIO_AGORA: String(S) },
      encoding: 'utf8',
    });
    const texto = readFileSync(join(cache, 'cadeiras.jsonl'), 'utf8');
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toContain('exemplo.invalid');
    expect(texto).not.toContain('fugu-ultra');
    expect(texto).not.toContain('claude-sonnet-5');
    const linhas = texto.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(linhas[0]).toEqual({ tipo: 'meta', gerado_em: S, versao: 1 });
    const permitidas: Record<string, string[]> = {
      meta: ['tipo', 'gerado_em', 'versao'],
      chamada: ['tipo', 'perfil', 'sessao', 'tarefa', 'model', 'provider', 'em', 'chamadas', 'reserva_de', 'reserva_para', 'reserva_provider', 'reserva_motivo', 'reserva_em'],
      sessao: ['tipo', 'perfil', 'sessao', 'model', 'billing_provider', 'started_at'],
      config: ['tipo', 'perfil', 'model', 'provider', 'fallback'],
      falha: ['tipo', 'perfil', 'erro'],
    };
    for (const l of linhas) {
      const ok = permitidas[String(l.tipo)];
      expect(ok, JSON.stringify(l)).toBeDefined();
      for (const k of Object.keys(l)) expect(ok, `${k} em ${String(l.tipo)}`).toContain(k);
    }
    const ch = linhas.filter((l) => l.tipo === 'chamada');
    expect(ch).toEqual([
      {
        tipo: 'chamada', perfil: 'dev', sessao: sid, tarefa: 't_607896d1', model: 'gemini-3.1-pro', provider: 'antigravity-agy', em: S - 150, chamadas: 2,
        reserva_de: 'claude-opus-5-5', reserva_para: 'gemini-3.1-pro', reserva_provider: 'antigravity-agy', reserva_motivo: 'limite', reserva_em: S - 199,
      },
      { tipo: 'chamada', perfil: 'dev', sessao: outra, tarefa: '', model: 'gpt-5.5', provider: 'openai-codex', em: S - 100, chamadas: 1 },
    ]);
    expect(linhas.filter((l) => l.tipo === 'sessao')).toEqual([
      { tipo: 'sessao', perfil: 'dev', sessao: sid, model: 'claude-opus-5-5', billing_provider: 'anthropic', started_at: S - 305 },
    ]);
    expect(linhas.find((l) => l.tipo === 'config')).toEqual({
      tipo: 'config', perfil: 'dev', model: 'claude-opus-5-5', provider: 'anthropic', fallback: ['antigravity-agy/gemini-3.1-pro', 'openai-codex/gpt-5.5'],
    });

    // e o servidor lê o que o script gerou
    const d = parseCadeiras(texto);
    expect(modeloDaCadeira(d, 'dev', 't_607896d1', S - 310)).toMatchObject({ assinatura: 'agy-gemini', reserva: true, principal: 'Claude Opus 5.5', motivo: 'limite' });
  });
});
