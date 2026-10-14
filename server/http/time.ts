// Rotas do time de agentes: diários gerados sem IA e cartões esperando o Victor.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { discoverBoards, firstLine, openReadOnly } from '../sources/hermes';

export interface TimeDiarioItem {
  date: string;
  profile: string;
  text: string;
}

export interface EsperandoVictorItem {
  board: string;
  taskId: string;
  title: string;
  assignee?: string;
  status: string;
  reason?: string;
}

export interface EsperandoVictorResponse {
  total: number;
  pendencias: number;
  portoes: number;
  items: EsperandoVictorItem[];
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validProfile(s: string): boolean {
  return /^[a-z][a-z0-9-]{0,31}$/.test(s);
}

function diarioBase(home: string): string {
  return join(home, '.local', 'state', 'time', 'diarios');
}

export function readDiarios(home: string, profile: string, date = todayLocal(), days = 8): TimeDiarioItem[] {
  if (!validProfile(profile) || !validDate(date)) return [];
  const base = diarioBase(home);
  const start = new Date(`${date}T12:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  const out: TimeDiarioItem[] = [];
  for (let i = 0; i < Math.max(1, Math.min(31, days)); i++) {
    const d = new Date(start.getTime() - i * 86_400_000);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = join(base, stamp, `${profile}.md`);
    if (!existsSync(file)) continue;
    try {
      out.push({ date: stamp, profile, text: readFileSync(file, 'utf8') });
    } catch {
      // ignora arquivo que sumiu no meio da leitura
    }
  }
  return out;
}

function payloadReason(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as unknown;
    if (!p || typeof p !== 'object') return undefined;
    const r = (p as Record<string, unknown>).reason ?? (p as Record<string, unknown>).message ?? (p as Record<string, unknown>).error;
    return typeof r === 'string' ? r : undefined;
  } catch {
    return undefined;
  }
}

function wantsVictor(text: string | undefined): boolean {
  if (!text) return false;
  return /\b(Victor|humano|aprova|aprovar|decis[aã]o|allow once|esperando o Victor|gate|port[aã]o|PR\s*#?\d+)/i.test(text);
}

export function esperandoVictor(root: string): EsperandoVictorResponse {
  const items: EsperandoVictorItem[] = [];
  let pendencias = 0;
  let portoes = 0;
  for (const b of discoverBoards(root)) {
    let db;
    try {
      db = openReadOnly(b.path);
      const rows = db
        .prepare("SELECT id,title,assignee,status,block_kind,last_failure_error FROM tasks WHERE status IS NOT 'done' AND status IS NOT 'archived' ORDER BY created_at DESC LIMIT 500")
        .all() as Array<{ id: string; title: string; assignee: string | null; status: string; block_kind: string | null; last_failure_error: string | null }>;
      let reasonStmt: { get(id: string): { payload: string | null } | undefined } | undefined;
      try {
        reasonStmt = db.prepare("SELECT payload FROM task_events WHERE task_id=? AND kind IN ('blocked','gave_up','spawn_failed','crashed','timed_out') ORDER BY id DESC LIMIT 1") as unknown as {
          get(id: string): { payload: string | null } | undefined;
        };
      } catch {
        reasonStmt = undefined;
      }
      for (const r of rows) {
        const reason = firstLine(payloadReason(reasonStmt?.get(r.id)?.payload) ?? r.last_failure_error ?? undefined);
        const isPendencia = b.board === 'pendencias';
        const isGate = !isPendencia && (r.block_kind === 'needs_input' || wantsVictor(reason) || wantsVictor(r.title));
        if (!isPendencia && !isGate) continue;
        if (isPendencia) pendencias++;
        else portoes++;
        items.push({ board: b.board, taskId: r.id, title: r.title, assignee: r.assignee ?? undefined, status: r.status, reason });
      }
    } catch {
      // Um board ilegível não derruba o Escritório.
    } finally {
      try {
        db?.close();
      } catch {
        // noop
      }
    }
  }
  return { total: items.length, pendencias, portoes, items };
}

export function handleTimeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: { home: string; hermesRoot: string; sendJson: (res: ServerResponse, status: number, body: unknown) => void },
): boolean {
  if (url.pathname === '/api/time/diarios') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET');
      deps.sendJson(res, 405, { error: 'método não permitido' });
    } else {
      const profile = url.searchParams.get('profile') ?? '';
      const date = url.searchParams.get('date') || todayLocal();
      const days = Number(url.searchParams.get('days') || 8);
      deps.sendJson(res, 200, { profile, date, items: readDiarios(deps.home, profile, date, Number.isFinite(days) ? days : 8) });
    }
    return true;
  }
  if (url.pathname === '/api/time/esperando-victor') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET');
      deps.sendJson(res, 405, { error: 'método não permitido' });
    } else {
      deps.sendJson(res, 200, esperandoVictor(deps.hermesRoot));
    }
    return true;
  }
  return false;
}

export function perfisComDiarioHoje(home: string): string[] {
  const dir = join(diarioBase(home), todayLocal());
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .filter(validProfile)
      .sort();
  } catch {
    return [];
  }
}
