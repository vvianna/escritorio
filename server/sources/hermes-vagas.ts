// Vagas dos trabalhadores do Hermes (modelo 1, Victor 11/10/2026): cada perfil (função) tem até
// max_in_progress_per_profile trabalhadores ao mesmo tempo; cada cartão running de um perfil ocupa a primeira vaga
// livre da função e fica com o nome dela (~/.hermes/time/nomes.json) enquanto rodar. Quando o cartão sai de running a
// vaga é liberada.
//
// O mapa cartão → vaga fica em <dataDir>/hermes-vagas.json (no Docker, o volume /data do habblaud) para o nome não
// trocar a cada ciclo nem a cada reinício do container. Só o escritório grava esse arquivo; os bancos do Hermes
// continuam só leitura.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { errMsg, log } from '../log';

/** Perfis que mantêm UM personagem só (personas e o Manager), mesmo com vários cartões rodando. */
export const SINGLE_PROFILES: ReadonlySet<string> = new Set(['default', 'vini', 'sergiao', 'alexa']);

/** Nomes por função, como em ~/.hermes/time/nomes.json: perfil → nomes das vagas, na ordem. */
export type Nomes = Map<string, string[]>;

/** Onde fica o nomes.json sob a raiz do Hermes (no Docker, /hermes/time/nomes.json, montado read-only). */
export function nomesPath(root: string): string {
  return join(root, 'time', 'nomes.json');
}

/** Lê o nomes.json; ausente ou ilegível = sem nomes (cai no 'dev #1'). Ignora chaves que não são função (_comentario). */
export function loadNomes(path: string): Nomes {
  const out: Nomes = new Map();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warnOnce(`hermes-nomes:${errMsg(err)}`, `Hermes: nomes.json ilegível (${errMsg(err)}); usando "dev #1".`);
    return out;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [profile, v] of Object.entries(raw as Record<string, unknown>)) {
    if (profile.startsWith('_') || !v || typeof v !== 'object') continue;
    const nomes = (v as { nomes?: unknown }).nomes;
    if (!Array.isArray(nomes)) continue;
    const clean = nomes.map((n) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 40) : '')).filter(Boolean);
    if (clean.length) out.set(profile, clean);
  }
  return out;
}

/** Nome do trabalhador da vaga `slot` (0 = 1ª): "Oswaldo Cruz (dev)"; sem nome para a vaga, "dev #2". */
export function workerName(profile: string, slot: number, nomes: Nomes): string {
  const n = nomes.get(profile)?.[slot];
  return n ? `${n} (${profile})` : `${profile} #${slot + 1}`;
}

/** Nome do personagem único (personas, Manager): "Hermes (default)" se o nomes.json der um; senão o perfil. */
export function singleName(profile: string, nomes: Nomes): string {
  const n = nomes.get(profile)?.[0];
  return n && n !== profile ? `${n} (${profile})` : profile;
}

/** Chave de um cartão (os ids de cartão só valem dentro do board). */
export function cardKey(board: string, taskId: string): string {
  return `${board}/${taskId}`;
}

function boardOfKey(key: string): string {
  const i = key.indexOf('/');
  return i < 0 ? key : key.slice(0, i);
}

/** Um cartão running pedindo vaga. */
export interface LiveCard {
  profile: string;
  board: string;
  taskId: string;
}

export class HermesSlots {
  /** perfil → (chave do cartão → vaga). */
  private slots = new Map<string, Map<string, number>>();
  private loaded = false;

  /** `file` null = só em memória (testes). */
  constructor(private readonly file: string | null) {}

  /** Vaga atual de um cartão (undefined = sem vaga). */
  get(profile: string, board: string, taskId: string): number | undefined {
    this.load();
    return this.slots.get(profile)?.get(cardKey(board, taskId));
  }

  /**
   * Acerta as vagas com os cartões running deste ciclo (na ordem dada: quem chegou primeiro pega a vaga mais baixa).
   * Libera a vaga de quem saiu de running, exceto nos boards em `keepBoards` (não deu para ler o board neste ciclo:
   * o cartão some da leitura, mas não saiu de running). Grava o arquivo só se algo mudou.
   */
  sync(live: readonly LiveCard[], keepBoards: ReadonlySet<string> = new Set()): void {
    this.load();
    let changed = false;
    const want = new Map<string, Set<string>>();
    for (const c of live) {
      let s = want.get(c.profile);
      if (!s) want.set(c.profile, (s = new Set()));
      s.add(cardKey(c.board, c.taskId));
    }
    for (const [profile, map] of this.slots) {
      const keep = want.get(profile);
      for (const key of [...map.keys()]) {
        if (keep?.has(key) || keepBoards.has(boardOfKey(key))) continue;
        map.delete(key);
        changed = true;
      }
      if (!map.size) this.slots.delete(profile);
    }
    for (const c of live) {
      const key = cardKey(c.board, c.taskId);
      let map = this.slots.get(c.profile);
      if (map?.has(key)) continue;
      if (!map) this.slots.set(c.profile, (map = new Map()));
      const used = new Set(map.values());
      let slot = 0;
      while (used.has(slot)) slot++;
      map.set(key, slot);
      changed = true;
    }
    if (changed) this.save();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { vagas?: Record<string, Record<string, unknown>> };
      for (const [profile, cards] of Object.entries(j.vagas ?? {})) {
        if (!cards || typeof cards !== 'object') continue;
        const map = new Map<string, number>();
        const used = new Set<number>();
        for (const [key, slot] of Object.entries(cards)) {
          if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || used.has(slot)) continue;
          used.add(slot);
          map.set(key, slot);
        }
        if (map.size) this.slots.set(profile, map);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`hermes-vagas.json ilegível (${errMsg(err)}); as vagas recomeçam do zero.`);
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const vagas = Object.fromEntries([...this.slots].sort(([a], [b]) => a.localeCompare(b)).map(([p, m]) => [p, Object.fromEntries(m)]));
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, vagas }, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warnOnce(`hermes-vagas:${errMsg(err)}`, `Não consegui gravar ${this.file}: ${errMsg(err)}`);
    }
  }
}
