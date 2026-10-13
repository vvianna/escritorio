// Fonte de agentes do Hermes (AgentSource 'hermes', ver sources/source.ts): lê os kanban.db do Hermes e põe um
// personagem por perfil no escritório, na sala do board do cartão que ele mostra (escritorio.md, "O que vira o quê").
//
// Só leitura: cada ciclo abre os bancos com SQLite `mode=ro` (node:sqlite, readOnly) e fecha em seguida. Lê só as
// tabelas `tasks`, `task_runs`, `task_events` e `task_comments` do kanban (colunas listadas nas consultas abaixo; dos
// comentários e heartbeats só a nota mais recente do run, para a Atividade; de `tasks` também quem criou o
// cartão, e só quando é nome de perfil, ver PERFIL_RE). Os state.db dos perfis NÃO são
// lidos aqui (a fonte de sessões/uso é outra). Nunca ler messages, system_prompt, title de sessão, chat_id, user_id,
// .env, auth.json nem config.yaml.
//
// Bancos: <HERMES_ROOT>/kanban.db (board "default") e <HERMES_ROOT>/kanban/boards/<board>/kanban.db.
//
// Estado de cada cartão aberto (prioridade quando um perfil tem vários: guarded > blocked > internal > delivering >
// running):
// - guarded (placa vermelha), mesmas regras do pl-opens-coleta.py: >=5 respawn_guarded do mesmo motivo em 10 min
//   (menos active_pr, ver internal), consecutive_failures >= 3, running sem heartbeat há mais de 60 min, ou blocked
//   cujo último evento de bloqueio é erro do sistema (gave_up, spawn_failed, crashed, timed_out — regra do nanny);
// - blocked: blocked esperando humano (levanta a mão; balão = 1ª linha do motivo, sem o "O que travou:");
// - internal (placa amarela "Manager resolvendo", sem mão): blocked de roteamento interno que o kanban-nanny resolve
//   sozinho (ver internalBlock: mesma regra do kanban-nanny.py), e (12/10) guarda de PR repetida (active_pr), que o
//   pl-opens-maos solta sozinho. Guarda repetida de qualquer motivo some assim que há `assigned` ou `spawned` depois
//   da última guarda (a guarda foi solta), sem esperar a janela de 10 min;
// - delivering: review_requested há menos de DELIVER_MS (vale para o `implementer` do evento) ou reatribuição para
//   reviewer/judge/qa/auditor (vale para o `from`);
// - running: status running do assignee.
// Perfil sem nada disso mas com cartão mexido nos últimos IDLE_DAYS dias fica no escritório à toa (café).
//
// Um personagem por trabalhador (modelo 1, ver sources/hermes-vagas.ts): cada cartão com status running de um perfil
// que não é persona nem o Manager (SINGLE_PROFILES) vira um personagem próprio, com o nome da vaga que ocupa
// ("Oswaldo Cruz (dev)", nomes em <HERMES_ROOT>/time/nomes.json; sem nome, "dev #1"). O personagem da função (nome =
// perfil) fica só com o resto (bloqueio, placa vermelha, entrega, à toa) e não aparece à toa enquanto a função tem
// trabalhadores rodando. Personas e o Manager seguem com um personagem só.
// Cartão destravado (saiu de blocked/internal ou foi reatribuído): a mão do perfil anterior abaixa e o "✋ Precisa de
// você" fica na Atividade marcado como "✅ Resolvido pelo Manager".
// Selo de provedor/modelo ao vivo de cada cadeira com cartão running e as linhas "passou para a reserva" / "⚙️ config
// mudou" na Atividade: vêm da cópia só-metadado cadeiras.jsonl (tools/copiar-uso.sh, ver sources/hermes-cadeira.ts).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { AgentStatus, HermesCard, HermesCardState, HermesModelo, SourceInfo } from '../../shared/types';
import { errMsg, log } from '../log';
import type { Office } from '../model/office';
import { CADEIRA_VELHA_MS, criarLeitorCadeiras, modeloDaCadeira, nomeModelo, ultimoModeloDoPerfil, type ConfigPerfil, type DadosCadeiras } from './hermes-cadeira';
import { HermesSlots, loadNomes, nomesPath, SINGLE_PROFILES, singleName, workerName } from './hermes-vagas';
import type { AgentSource } from './source';

export const GUARD_WINDOW_S = 10 * 60;
export const GUARD_MIN = 5;
export const FAILURES_MIN = 3;
export const STALE_HEARTBEAT_S = 60 * 60;
export const DELIVER_MS = 3 * 60_000;
export const IDLE_DAYS = 7;
const SYSTEM_BLOCK = new Set(['gave_up', 'spawn_failed', 'crashed', 'timed_out']);
const BLOCK_EVENTS = ['blocked', ...SYSTEM_BLOCK];
const REVIEWERS = new Set(['reviewer', 'judge', 'qa', 'auditor']);
const RANK: Record<HermesCardState, number> = { running: 1, delivering: 2, internal: 3, blocked: 4, guarded: 5 };
const ROLE = 'Perfil do Hermes';

/** Um kanban.db achado. */
export interface HermesBoard {
  board: string;
  path: string;
}

/** O que um board diz de um perfil: o cartão mais importante e o momento (s) da última mexida dele. */
export interface ProfileCard extends HermesCard {
  profile: string;
  /** Epoch s do que decidiu o estado (para desempate: o mais recente vence). */
  at: number;
  /** Cartão com status running no kanban (tem um trabalhador rodando): epoch s de quando começou. */
  liveSince?: number;
  /** Início (epoch s) do run atual (task_runs.started_at de current_run_id): casa o cartão com a sessão do worker. */
  runStartedAt?: number;
}

export interface BoardRead {
  cards: ProfileCard[];
  /** Perfis com cartão mexido na janela de IDLE_DAYS: perfil → {board, at (s)}. */
  recent: Map<string, number>;
}

/** Os kanban.db do Hermes sob `root`. */
export function discoverBoards(root: string): HermesBoard[] {
  const out: HermesBoard[] = [];
  const main = join(root, 'kanban.db');
  if (existsSync(main)) out.push({ board: 'default', path: main });
  const dir = join(root, 'kanban', 'boards');
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    // sem boards nomeados
  }
  for (const name of names) {
    const path = join(dir, name, 'kanban.db');
    if (existsSync(path)) out.push({ board: name, path });
  }
  return out;
}

/**
 * Abre só para leitura (URI `mode=ro`, além do readOnly do node:sqlite).
 *
 * Montagem `:ro` (pasta ~/.hermes/kanban no container): banco em WAL sem o `-shm` no disco (nenhum processo do
 * Hermes com ele aberto) não abre em `mode=ro`, porque o SQLite precisaria criar o `-shm` numa pasta só leitura.
 * Nesse caso não há escritor, o `-wal` já foi aplicado e apagado e o arquivo principal está completo: reabre com
 * `immutable=1` (lê o arquivo como está, sem trava nem `-shm`). Se ainda assim vier algo pela metade, o próximo
 * ciclo relê.
 */
export function openReadOnly(path: string): DatabaseSync {
  const uri = `file:${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}?mode=ro`;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(uri, { readOnly: true });
    db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
    return db;
  } catch (err) {
    try {
      db?.close();
    } catch {
      /* já fechado */
    }
    if (!existsSync(path)) throw err;
    return new DatabaseSync(`${uri}&immutable=1`, { readOnly: true });
  }
}

function payloadOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Boards em que "esperar merge de PR aprovado" é do opens-automerge, não do Victor (mesma lista do kanban-nanny). */
const AUTOMERGE_BOARDS = new Set(['openfinance', 'openhealth', 'openinfra', 'hermes-lab', 'choppinho']);

/**
 * Bloqueio que NÃO é com o Victor: roteamento interno que o kanban-nanny / o Manager resolvem sozinhos. Mesma regra do
 * ~/.hermes/scripts/kanban-nanny.py (regexes copiadas de lá) mais conflito com a main e espera de tag/release.
 * Devolve o rótulo curto do caso, ou undefined quando é para humano (aí levanta a mão).
 */
export function internalBlock(board: string, reason: string | undefined): string | undefined {
  const txt = (reason ?? '').replace(/\\n/g, '\n');
  if (!txt.trim()) return undefined;
  // 09/10 (nanny): PR aprovado esperando merge — o opens-automerge mergeia e desbloqueia.
  if (AUTOMERGE_BOARDS.has(board) && /merg\w*\s+(o\s+)?PR\s*#?\d+|PR\s*#?\d+.{0,80}(sem merge|não foi mergeado|ainda não (entrou|foi))/i.test(txt)) {
    return 'PR aprovado esperando merge';
  }
  // 10/10 (nanny): correção do judge cai no reviewer; o nanny reatribui ao dev.
  if (/reatribu\w*\s+(\S+\s+){0,3}(para|ao)\s+(o\s+)?(perfil\s+)?dev\b|(conserto|corre[cç][aã]o)\s+(é|e)\s+do\s+dev|n[aã]o escreve c[oó]digo/i.test(txt)) {
    return 'correção volta para o dev';
  }
  // Conflito do PR com a main: quem resolve é o dev (o Manager reatribui).
  if (/conflit\w*\s+com\s+(a\s+)?(origin\/)?(main|master)\b|PR\s*#?\d+.{0,120}conflit|conflit\w*.{0,120}quem resolve\s+(é|e)\b/is.test(txt)) {
    return 'conflito com a main';
  }
  // 10–11/10 (nanny): SOUL.md.proposto — o nanny renomeia sozinho.
  if (/SOUL\.md\.proposto/i.test(txt)) return 'SOUL.md.proposto';
  // Espera de tag/release: anda sozinho quando a tag/release sai.
  if (/(esper\w*|aguard\w*)\s+(\S+\s+){0,4}(tag|release)\b|(tag|release)\s+(\S+\s+){0,4}(sair|ser publicad\w*|ser criad\w*)/i.test(txt)) {
    return 'esperando tag/release';
  }
  return undefined;
}

/** 1ª linha útil do motivo, sem o rótulo "O que travou:", até 160 caracteres. */
export function firstLine(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const line = reason
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  const clean = line.replace(/^\**o que travou:?\**\s*/i, '').trim() || line;
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean;
}

export const NOTA_MAX = 200;

/** Texto de nota numa linha só (espaços juntados, sem marcação de título/negrito), até NOTA_MAX caracteres. */
export function notaCurta(text: string | null | undefined): string | undefined {
  const clean = (text ?? '')
    .replace(/\\n/g, '\n')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  return clean.length > NOTA_MAX ? `${clean.slice(0, NOTA_MAX - 1)}…` : clean;
}

/**
 * O que o perfil está fazendo no cartão: a nota mais recente entre heartbeat (payload.note) e comentário desde `since`
 * (início do run atual; 0 = qualquer um); sem nenhum, a 1ª linha do corpo. Só tasks/task_events/task_comments.
 */
function notaDoCartao(
  q: { beat: StatementSync; comment: StatementSync | null; body: StatementSync },
  taskId: string,
  since: number,
): { nota: string; notaEm: number } | undefined {
  let best: { nota: string; notaEm: number } | undefined;
  for (const r of q.beat.all(taskId, since) as Array<{ payload: string | null; created_at: number }>) {
    const nota = notaCurta(str(payloadOf(r.payload).note));
    if (nota) {
      best = { nota, notaEm: r.created_at * 1000 };
      break;
    }
  }
  const c = q.comment?.get(taskId, since) as { body: string | null; created_at: number } | undefined;
  const cn = notaCurta(c?.body);
  if (c && cn && (!best || c.created_at * 1000 >= best.notaEm)) best = { nota: cn, notaEm: c.created_at * 1000 };
  if (best) return best;
  const t = q.body.get(taskId) as { body: string | null; created_at: number } | undefined;
  const line = (t?.body ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  const nota = notaCurta(line);
  return nota && t ? { nota, notaEm: t.created_at * 1000 } : undefined;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  consecutive_failures: number | null;
  last_heartbeat_at: number | null;
  started_at: number | null;
  created_at: number;
  current_run_id: number | null;
  criador: string | null;
}

/** Nome de perfil do Hermes (descarta vazio e origens como "telegram:123", e-mail, espaço ou dígito no começo). */
const PERFIL_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Lê um board: o estado de cada cartão aberto (por perfil) e os perfis com cartão recente. `now` em ms. */
export function readBoard(db: DatabaseSync, board: string, now: number): BoardRead {
  const t0 = Math.floor(now / 1000);
  const cards: ProfileCard[] = [];
  const runBeat = db.prepare('SELECT COALESCE(last_heartbeat_at, started_at) AS at FROM task_runs WHERE id=?');
  const runStart = db.prepare('SELECT started_at FROM task_runs WHERE id=?');
  let comment: StatementSync | null = null;
  try {
    comment = db.prepare('SELECT body, created_at FROM task_comments WHERE task_id=? AND created_at >= ? ORDER BY id DESC LIMIT 1');
  } catch {
    comment = null; // kanban.db sem a tabela de comentários
  }
  const notaQ = {
    beat: db.prepare(
      "SELECT payload, created_at FROM task_events WHERE task_id=? AND kind='heartbeat' AND payload IS NOT NULL AND created_at >= ? ORDER BY id DESC LIMIT 20",
    ),
    comment,
    body: db.prepare('SELECT body, created_at FROM tasks WHERE id=?'),
  };
  const add = (profile: string | null | undefined, task: TaskRow, state: HermesCardState, at: number, reason?: string) => {
    if (!profile) return;
    const card: ProfileCard = { profile, board, taskId: task.id, title: task.title, state, at };
    if (reason) card.reason = reason;
    if (task.criador && PERFIL_RE.test(task.criador)) card.criadoPor = task.criador;
    if (task.status === 'running' && (state === 'running' || state === 'guarded')) {
      card.liveSince = task.started_at ?? task.created_at;
      let run: number | null | undefined;
      if (task.current_run_id != null) {
        try {
          run = (runStart.get(task.current_run_id) as { started_at: number | null } | undefined)?.started_at;
        } catch {
          run = undefined;
        }
      }
      card.runStartedAt = run ?? card.liveSince;
    }
    const nota = notaDoCartao(notaQ, task.id, card.runStartedAt ?? 0);
    if (nota) Object.assign(card, nota);
    cards.push(card);
  };

  const tasks = db
    .prepare(
      'SELECT id, title, status, assignee, consecutive_failures, last_heartbeat_at, started_at, created_at, current_run_id, ' +
        "created_by AS criador FROM tasks WHERE status NOT IN ('done','archived')",
    )
    .all() as unknown as TaskRow[];
  const open = new Map(tasks.map((t) => [t.id, t]));

  // respawn_guarded repetido (janela de 10 min, por cartão e motivo)
  const guards = new Map<string, number>();
  const lastGuard = new Map<string, number>();
  for (const r of db
    .prepare("SELECT task_id, payload, created_at FROM task_events WHERE kind='respawn_guarded' AND created_at > ? AND created_at <= ?")
    .all(t0 - GUARD_WINDOW_S, t0) as Array<{ task_id: string; payload: string | null; created_at: number }>) {
    if (!open.has(r.task_id)) continue;
    const key = `${r.task_id}\u0000${str(payloadOf(r.payload).reason) ?? '?'}`;
    guards.set(key, (guards.get(key) ?? 0) + 1);
    lastGuard.set(r.task_id, Math.max(lastGuard.get(r.task_id) ?? 0, r.created_at));
  }
  // 12/10: a guarda já foi solta (reatribuição ou worker iniciado depois da última guarda) → o alerta some na hora,
  // sem esperar a janela de 10 min esvaziar.
  const movedAfter = db.prepare("SELECT 1 FROM task_events WHERE task_id=? AND kind IN ('assigned','spawned') AND created_at >= ? LIMIT 1");
  const guardedBy = new Map<string, string>();
  const guardInternalBy = new Map<string, string>();
  for (const [key, n] of guards) {
    if (n < GUARD_MIN) continue;
    const [tid, why] = key.split('\u0000');
    if (movedAfter.get(tid, lastGuard.get(tid) ?? t0)) continue;
    // 12/10 (Victor): a guarda de PR (active_pr) é trabalho do Manager (pl-opens-maos solta sozinho), não do Victor:
    // placa amarela "Manager resolvendo", sem mão. Os outros motivos seguem placa vermelha.
    if (why === 'active_pr') guardInternalBy.set(tid, `guarda de PR repetida (active_pr) ${GUARD_MIN}+ em 10 min`);
    else guardedBy.set(tid, `guarda repetida (${why}) ${GUARD_MIN}+ em 10 min`);
  }

  const lastBlock = db.prepare(
    `SELECT kind, payload, created_at FROM task_events WHERE task_id=? AND kind IN (${BLOCK_EVENTS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`,
  );

  for (const t of tasks) {
    const fails = t.consecutive_failures ?? 0;
    let guard = guardedBy.get(t.id);
    if (!guard && fails >= FAILURES_MIN) guard = `${fails} falhas seguidas`;
    if (t.status === 'running') {
      let ref = t.last_heartbeat_at;
      if (ref == null && t.current_run_id != null) {
        try {
          ref = (runBeat.get(t.current_run_id) as { at: number | null } | undefined)?.at ?? null;
        } catch {
          ref = null;
        }
      }
      ref ??= t.started_at ?? t.created_at;
      if (!guard && t0 - ref > STALE_HEARTBEAT_S) guard = `sem sinal de vida há ${Math.floor((t0 - ref) / 60)} min`;
      if (guard) add(t.assignee, t, 'guarded', t0, guard);
      else add(t.assignee, t, 'running', ref);
    } else if (t.status === 'blocked') {
      const ev = lastBlock.get(t.id, ...BLOCK_EVENTS) as { kind: string; payload: string | null; created_at: number } | undefined;
      const at = ev?.created_at ?? t.created_at;
      if (!guard && ev && SYSTEM_BLOCK.has(ev.kind)) guard = `erro do sistema (${ev.kind})`;
      const why = str(payloadOf(ev?.payload).reason);
      const internal = guard ? undefined : internalBlock(board, why);
      if (guard) add(t.assignee, t, 'guarded', at, guard);
      else if (internal) add(t.assignee, t, 'internal', at, internal);
      else add(t.assignee, t, 'blocked', at, firstLine(why) ?? '(bloqueou sem escrever o motivo)');
    } else if (guard) {
      add(t.assignee, t, 'guarded', t0, guard);
    } else if (guardInternalBy.has(t.id)) {
      add(t.assignee, t, 'internal', lastGuard.get(t.id) ?? t0, guardInternalBy.get(t.id));
    }
  }

  // Entregas recentes ao revisor (o cartão pode até já estar fechado).
  const since = Math.floor((now - DELIVER_MS) / 1000);
  const titleOf = db.prepare(
    'SELECT id, title, status, assignee, consecutive_failures, last_heartbeat_at, started_at, created_at, current_run_id, ' +
      'created_by AS criador FROM tasks WHERE id=?',
  );
  for (const r of db
    .prepare("SELECT task_id, kind, payload, created_at FROM task_events WHERE kind IN ('review_requested','assigned') AND created_at > ? ORDER BY id")
    .all(since) as Array<{ task_id: string; kind: string; payload: string | null; created_at: number }>) {
    const p = payloadOf(r.payload);
    let who: string | undefined;
    let to: string | undefined;
    if (r.kind === 'review_requested') {
      who = str(p.implementer);
      to = str(p.reviewer);
    } else {
      to = str(p.assignee);
      if (to && REVIEWERS.has(to)) who = str(p.from);
    }
    if (!who || who === to) continue;
    const task = open.get(r.task_id) ?? (titleOf.get(r.task_id) as TaskRow | undefined);
    if (task) add(who, task, 'delivering', r.created_at, to ? `entregou para ${to}` : 'entregou para revisão');
  }

  const recent = new Map<string, number>();
  for (const r of db
    .prepare(
      'SELECT assignee, MAX(COALESCE(completed_at, started_at, created_at)) AS at FROM tasks ' +
        "WHERE assignee IS NOT NULL AND assignee <> '' AND status <> 'archived' " +
        'AND COALESCE(completed_at, started_at, created_at) > ? GROUP BY assignee',
    )
    .all(t0 - IDLE_DAYS * 86400) as Array<{ assignee: string; at: number }>) {
    recent.set(r.assignee, r.at);
  }
  return { cards, recent };
}

/** O cartão que cada perfil mostra: maior prioridade; empate = o mais recente. */
export function pickCards(cards: readonly ProfileCard[]): Map<string, ProfileCard> {
  const out = new Map<string, ProfileCard>();
  for (const c of cards) {
    const cur = out.get(c.profile);
    if (!cur || RANK[c.state] > RANK[cur.state] || (RANK[c.state] === RANK[cur.state] && c.at > cur.at)) out.set(c.profile, c);
  }
  return out;
}

function statusOf(state: HermesCardState | undefined): AgentStatus {
  if (state === 'blocked' || state === 'guarded') return 'waiting';
  return state ? 'working' : 'idle';
}

function waitingOf(card: ProfileCard | undefined): string | undefined {
  if (!card) return undefined;
  if (card.state === 'blocked') return card.reason ?? 'responder no kanban';
  if (card.state === 'guarded') return `⚠ ${card.reason ?? 'placa vermelha'}`;
  return undefined;
}

const ICON: Record<HermesCardState, string> = { running: '⌨️', blocked: '✋', guarded: '🛑', delivering: '📦', internal: '🟡' };
const VERB: Record<HermesCardState, string> = {
  running: 'Trabalhando',
  blocked: 'Precisa de você',
  guarded: 'Placa vermelha',
  delivering: 'Entregando',
  internal: 'Manager resolvendo',
};
/** Estados em que o perfil espera alguém (mão levantada ou placa amarela): somem quando o cartão é destravado. */
const HAND = new Set<HermesCardState>(['blocked', 'internal']);
const RESOLVED_ICON = '✅';

/** Pasta-sala de um board (vira a sala no escritório). */
export function roomCwd(board: string): string {
  return `/hermes/${board}`;
}

export interface HermesSourceOptions {
  office: Office;
  /** Raiz do Hermes lida por este processo (no Docker, /hermes). */
  root: string;
  now?: () => number;
  pollMs?: number;
  /** nomes.json das vagas (padrão <root>/time/nomes.json). */
  nomesFile?: string;
  /** Onde guardar o mapa cartão → vaga (no Docker, /data/hermes-vagas.json); null/ausente = só em memória. */
  slotsFile?: string | null;
  /**
   * cadeiras.jsonl de tools/copiar-uso.sh (provedor/modelo ao vivo de cada cadeira e configuração dos perfis; no
   * Docker, /cache/escritorio/cadeiras.jsonl). null/ausente = sem selo de modelo.
   */
  cadeirasFile?: string | null;
}

interface BoardState extends HermesBoard {
  ok: boolean;
  error?: string;
}

/** Um personagem deste ciclo: o da função (um por perfil) ou o de um trabalhador (um por cartão running). */
interface Character {
  id: string;
  profile: string;
  board: string;
  name: string;
  role: string;
  card?: ProfileCard;
  /** Vaga do trabalhador (1 = 1ª); ausente no personagem da função. */
  slot?: number;
}

const WORKER_ROLE = 'Trabalhador do Hermes';

export class HermesSource implements AgentSource {
  readonly provider = 'hermes' as const;
  private boards: BoardState[] = [];
  /** Id do personagem → board da sala atual. */
  private present = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly slots: HermesSlots;
  private readonly lerCadeiras: () => DadosCadeiras;
  /** Último selo de cada personagem (por cartão): detecta a troca para a reserva. */
  private modelos = new Map<string, { taskId: string; modelo: HermesModelo }>();
  /** Última configuração vista de cada perfil (hash de model/provider/fallback_providers). */
  private configs = new Map<string, ConfigPerfil>();

  constructor(private readonly opts: HermesSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.slots = new HermesSlots(opts.slotsFile ?? null);
    this.lerCadeiras = criarLeitorCadeiras(opts.cadeirasFile ?? null);
  }

  start(): void {
    this.opts.office.beginBoot();
    try {
      this.poll();
    } finally {
      this.opts.office.endBoot();
    }
    this.timer = setInterval(() => {
      try {
        this.poll();
      } catch (err) {
        log.warnOnce(`hermes-poll:${errMsg(err)}`, `Hermes: falha no ciclo de leitura: ${errMsg(err)}`);
      }
    }, this.opts.pollMs ?? 5_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sources(): SourceInfo[] {
    return this.boards.map((b) => {
      let sessions = 0;
      for (const board of this.present.values()) if (board === b.board) sessions++;
      const info: SourceInfo = { label: b.board, provider: 'hermes', path: b.path, sessions, ok: b.ok };
      if (b.error) info.error = b.error;
      return info;
    });
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /** Um ciclo: relê todos os boards e acerta os personagens. */
  poll(): void {
    const now = this.now();
    this.boards = discoverBoards(this.opts.root).map((b) => ({ ...b, ok: true }));
    const cards: ProfileCard[] = [];
    const recent = new Map<string, { board: string; at: number }>();
    for (const b of this.boards) {
      let db: DatabaseSync | undefined;
      try {
        db = openReadOnly(b.path);
        const r = readBoard(db, b.board, now);
        cards.push(...r.cards);
        for (const [profile, at] of r.recent) {
          const cur = recent.get(profile);
          if (!cur || at > cur.at) recent.set(profile, { board: b.board, at });
        }
      } catch (err) {
        b.ok = false;
        b.error = errMsg(err);
        log.warnOnce(`hermes-board:${b.board}:${b.error}`, `Hermes: não consegui ler o board ${b.board} (${b.error}).`);
      }
      db?.close();
    }
    const failed = new Set(this.boards.filter((b) => !b.ok).map((b) => b.board));
    const nomes = loadNomes(this.opts.nomesFile ?? nomesPath(this.opts.root));

    // Trabalhadores: um por cartão running (fora personas e Manager); quem começou antes pega a vaga mais baixa.
    const live = cards
      .filter((c) => c.liveSince !== undefined && !SINGLE_PROFILES.has(c.profile))
      .sort((a, b) => a.liveSince! - b.liveSince! || a.board.localeCompare(b.board) || a.taskId.localeCompare(b.taskId));
    this.slots.sync(live, failed);
    const chars: Character[] = [];
    const working = new Set<string>();
    for (const c of live) {
      const slot = this.slots.get(c.profile, c.board, c.taskId) ?? 0;
      working.add(c.profile);
      chars.push({
        id: `hermes:${c.profile}:${c.board}:${c.taskId}`,
        profile: c.profile,
        board: c.board,
        name: workerName(c.profile, slot, nomes),
        role: `${WORKER_ROLE} (${c.profile}, vaga ${slot + 1})`,
        card: c,
        slot: slot + 1,
      });
    }

    // Personagem da função: o resto (bloqueio, placa vermelha, entrega) ou à toa — à toa só se a função não tem
    // ninguém rodando.
    const liveSet = new Set(live);
    const picked = pickCards(cards.filter((c) => !liveSet.has(c)));
    for (const profile of new Set([...picked.keys(), ...recent.keys()])) {
      const card = picked.get(profile);
      if (!card && working.has(profile)) continue;
      chars.push({
        id: `hermes:${profile}`,
        profile,
        board: card?.board ?? recent.get(profile)!.board,
        name: SINGLE_PROFILES.has(profile) ? singleName(profile, nomes) : profile,
        role: ROLE,
        card,
      });
    }

    const seen = new Set<string>();
    for (const ch of chars) {
      this.upsert(ch, cards, now);
      seen.add(ch.id);
    }
    this.cadeiras(chars, now);
    for (const [id, board] of [...this.present]) {
      if (seen.has(id) || failed.has(board)) continue;
      this.resolveHand(id, cards, true);
      this.opts.office.closeMain(id);
      this.present.delete(id);
      this.modelos.delete(id);
    }
  }

  /**
   * Selo de provedor/modelo de cada cadeira com cartão running (ver sources/hermes-cadeira.ts) e as linhas da Atividade
   * quando a cadeira troca de modelo no meio do cartão (reserva) ou quando a configuração de um perfil muda.
   */
  private cadeiras(chars: readonly Character[], now: number): void {
    const office = this.opts.office;
    const dados = this.lerCadeiras();
    const velha = !dados.copiadoEm || now - dados.copiadoEm > CADEIRA_VELHA_MS;
    for (const ch of chars) {
      const card = ch.card;
      if (!card || card.liveSince === undefined) {
        // À toa (ou cartão sem worker): o último modelo que o perfil usou, marcado `ocioso`.
        office.setHermesModelo(ch.id, ultimoModeloDoPerfil(dados, ch.profile));
        this.modelos.delete(ch.id);
        continue;
      }
      const prev = this.modelos.get(ch.id);
      const cur = modeloDaCadeira(dados, ch.profile, card.taskId, card.runStartedAt);
      // Cópia velha (cron parado) ou sem dado: fica o último selo deste cartão.
      if (!cur || (velha && prev?.taskId === card.taskId)) {
        if (prev?.taskId !== card.taskId) office.setHermesModelo(ch.id, cur);
        continue;
      }
      office.setHermesModelo(ch.id, cur);
      this.modelos.set(ch.id, { taskId: card.taskId, modelo: cur });
      const antes = prev?.taskId === card.taskId ? prev.modelo : undefined;
      let de: string | undefined;
      if (antes && (antes.provider !== cur.provider || antes.model !== cur.model)) de = antes.nome;
      // Já chegou na reserva (a troca foi entre duas cópias): a linha sai uma vez, com o principal.
      else if (!antes && cur.reserva && cur.motivo && cur.principal) de = cur.principal;
      if (!de) continue;
      const volta = !cur.reserva;
      // A linha do feed já mostra o personagem: o texto começa pela troca (o que importa cabe antes das reticências);
      // a frase inteira, com o nome, fica no detalhe (hover).
      const troca = volta ? `voltou de ${de} para ${cur.nome}` : `passou de ${de} para ${cur.nome} (reserva) — motivo: ${cur.motivo ?? 'desconhecido'}`;
      office.addActivity(
        ch.id,
        {
          id: `${ch.id}#modelo:${card.taskId}:${cur.provider}/${cur.model}:${cur.em ?? now}`,
          kind: 'other',
          icon: volta ? '↩' : '↪',
          text: troca,
          detail: `${ch.name} ${troca} · ${card.board} · ${card.taskId} · ${cur.provider}/${cur.model}`,
          tool: 'Hermes',
          at: cur.em ?? now,
          cartao: { board: card.board, taskId: card.taskId },
        },
        false,
      );
    }

    // Configuração do perfil (model/provider/fallback_providers): compara o hash a cada ciclo.
    if (velha) return;
    for (const [perfil, cfg] of dados.configs) {
      const antes = this.configs.get(perfil);
      this.configs.set(perfil, cfg);
      if (!antes || antes.hash === cfg.hash) continue;
      const alvo = this.opts.office.has(`hermes:${perfil}`) ? `hermes:${perfil}` : chars.find((c) => c.profile === perfil)?.id;
      if (!alvo) continue;
      const principal = antes.model !== cfg.model || antes.provider !== cfg.provider;
      const texto = principal
        ? `${perfil}: modelo principal agora é ${nomeModelo(cfg.model)}`
        : `${perfil}: reserva agora é ${cfg.fallback.map((f) => nomeModelo(f)).join(', ') || 'nenhuma'}`;
      office.addActivity(
        alvo,
        {
          id: `${alvo}#config:${cfg.hash}:${now}`,
          kind: 'other',
          icon: '⚙️',
          text: texto,
          detail: principal
            ? `${perfil}: de ${nomeModelo(antes.model)} (${antes.provider || '?'}) para ${nomeModelo(cfg.model)} (${cfg.provider || '?'})`
            : `${perfil}: reserva era ${antes.fallback.join(', ') || 'nenhuma'}; agora ${cfg.fallback.join(', ') || 'nenhuma'}`,
          tool: 'Hermes',
          at: now,
        },
        false,
      );
    }
  }

  /** Cria ou acerta um personagem com o cartão que ele mostra. */
  private upsert(ch: Character, cards: readonly ProfileCard[], now: number): void {
    const office = this.opts.office;
    const { id, card } = ch;
    const status = statusOf(card?.state);
    if (!office.has(id) || office.get(id)?.status === 'offline') {
      office.addMain({
        id,
        provider: 'hermes',
        account: 'hermes',
        sessionId: id,
        cwd: roomCwd(ch.board),
        role: ch.role,
        name: ch.name,
        hermesProfile: ch.profile,
        ...(ch.slot ? { hermesSlot: ch.slot } : {}),
        startedAt: card ? (card.liveSince ?? card.at) * 1000 : now,
        status,
        waitingFor: waitingOf(card),
      });
    } else {
      office.moveMain(id, roomCwd(ch.board));
      office.setStatus(id, status, waitingOf(card));
    }
    const prev = office.get(id)?.hermes;
    this.resolveHand(id, cards, !card);
    office.setHermes(
      id,
      card
        ? {
            board: card.board,
            taskId: card.taskId,
            title: card.title,
            state: card.state,
            ...(card.reason ? { reason: card.reason } : {}),
            ...(card.nota ? { nota: card.nota, notaEm: card.notaEm } : {}),
            ...(card.criadoPor ? { criadoPor: card.criadoPor } : {}),
          }
        : undefined,
    );
    if (card && (prev?.taskId !== card.taskId || prev?.state !== card.state)) {
      office.addActivity(
        id,
        {
          id: `${id}#${card.board}:${card.taskId}:${card.state}:${card.at}`,
          kind: card.state === 'delivering' ? 'communicate' : card.state === 'running' || card.state === 'internal' ? 'other' : 'wait',
          icon: ICON[card.state],
          text: `${VERB[card.state]}: ${card.title}`.slice(0, 46),
          detail: `${card.board} · ${card.taskId}${card.reason ? ` · ${card.reason}` : ''}`,
          tool: 'Hermes',
          at: card.at * 1000,
          cartao: { board: card.board, taskId: card.taskId },
        },
        true,
      );
    }
    this.present.set(id, ch.board);
  }

  /**
   * Destravado (saiu de blocked, ou foi reatribuído a outro perfil): a mão abaixa e o "✋ Precisa de você" fica no
   * histórico marcado como resolvido. `current` = sem outro cartão: o balão passa a ser esse "✅ resolvido".
   */
  private resolveHand(id: string, cards: readonly ProfileCard[], current: boolean): void {
    const office = this.opts.office;
    const info = office.get(id);
    const prev = info?.hermes;
    const profile = info?.hermesProfile;
    if (!prev || !HAND.has(prev.state)) return;
    if (cards.some((c) => c.profile === profile && c.board === prev.board && c.taskId === prev.taskId && c.state === prev.state)) return;
    const prefix = `${id}#${prev.board}:${prev.taskId}:${prev.state}:`;
    office.rewriteActivities(
      id,
      (a) => a.id.startsWith(prefix) && a.icon !== RESOLVED_ICON,
      (a) => ({
        ...a,
        kind: 'done',
        icon: RESOLVED_ICON,
        text: `Resolvido pelo Manager: ${prev.title}`.slice(0, 46),
        detail: `${a.detail ?? `${prev.board} · ${prev.taskId}`} · era: ${VERB[prev.state]}`.slice(0, 300),
      }),
      current,
    );
    if (current) office.setHermes(id, undefined);
  }
}
