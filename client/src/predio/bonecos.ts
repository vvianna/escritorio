// Personagens da vista Prédio (specs/predio-vertical.md, D1 e S6): quem senta, digita, levanta a mão, passeia até a
// copa ou conversa na Recepção. Copiado e organizado do protótipo (branch prototipo/predio-vertical, `criarBonecos` e
// `passoBoneco`), agora reconciliando por agentId a cada render(): entra quem chegou, sai quem sumiu há mais de 3 s
// e a mesa fica estável por agente enquanto ele não muda de sala. Viagens pelo elevador chegam na S8.
import { TILE, type ArtModule, type Appearance, type Dir, type HeldItem, type IconName, type Pose } from '../art/api';
import { hash32 } from '../../../shared/hash';
import type { AreaLayout, SpotDef } from '../world/layout/types';
import type { PathFinder } from '../world/path/astar';
import type { WalkGrid } from '../world/path/grid';
import type { Ocupante, PredioVista } from '../ui/predio-model';
import type { AndarCena, Cena } from './planta';

/** Quem sumiu do snapshot fica na cena por este tempo (piscadas do snapshot não fazem o boneco sumir e voltar). */
export const SUMIR_MS = 3000;
/** px de mundo por segundo (o mesmo andar do mapa das salas). */
const SPEED = 3.2 * TILE;

export interface Boneco {
  id: string;
  o: Ocupante;
  sala: string;
  andar: AndarCena;
  ap: Appearance;
  seed: number;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  held: HeldItem;
  seated: boolean;
  icone?: IconName;
  mesa?: SpotDef;
  alvo?: SpotDef;
  path: number[];
  pi: number;
  esperaAte: number;
  modo: 'mesa' | 'passeia' | 'entrega' | 'fixo';
  /** Topo da cabeça em px de mundo, do último quadro desenhado (para o crachá). */
  head: { x: number; y: number; ok: boolean };
  /** Quando deixou de aparecer no snapshot (ms); ausente = está no snapshot. */
  sumiuEm?: number;
}

const PASSEIO = new Set(['coffee', 'water', 'talk', 'window', 'cafe_seat', 'snack', 'bench', 'armchair', 'whiteboard', 'fridge']);
const RECEPCAO = new Set(['talk', 'bench', 'armchair', 'water', 'elevator']);
// espalha: N esquerda, N direita, S meio, N meio, S esquerda, S direita (crachás não se cobrem)
const ORDEM_MESA = ['N0', 'N2', 'S1', 'N1', 'S0', 'S2'];

export class Bonecos {
  readonly lista: Boneco[] = [];
  /** Mesa (id do spot) → quem senta nela, para a tela do monitor. */
  readonly porMesa = new Map<string, Boneco>();
  private readonly porId = new Map<string, Boneco>();
  private readonly ocupados = new Set<string>();

  constructor(
    private readonly cena: Cena,
    private readonly art: Pick<ArtModule, 'appearanceFromSeed'>,
  ) {}

  /** Põe a cena em dia com a vista: entra quem chegou, atualiza quem mudou e marca quem sumiu. */
  reconciliar(v: PredioVista, agora: number): void {
    const vistos = new Set<string>();
    for (const andar of v.andares) {
      const ac = this.cena.andares.find((a) => a.id === andar.id);
      if (!ac) continue;
      for (const s of andar.salas) {
        s.ocupantes.forEach((o, k) => {
          const id = o.agentId ?? `${s.id}:${o.perfil}:${k}`;
          if (vistos.has(id)) return;
          vistos.add(id);
          const area = this.cena.salaDe.get(s.id);
          let b = this.porId.get(id);
          if (!b) {
            const seed = hash32(id);
            b = { id, o, sala: s.id, andar: ac, ap: this.art.appearanceFromSeed(seed), seed, x: 0, y: 0, dir: 'down', pose: 'stand', held: 'none', seated: false, path: [], pi: 0, esperaAte: 0, modo: 'fixo', head: { x: 0, y: 0, ok: false } };
            this.porId.set(id, b);
            this.lista.push(b);
            this.configurar(b, area, k, true);
            return;
          }
          b.sumiuEm = undefined;
          const mudouSala = b.sala !== s.id;
          const mudouEstado = b.o.estado !== o.estado || b.o.perfil !== o.perfil;
          b.o = o;
          if (!mudouSala && !mudouEstado) return;
          if (mudouSala) this.soltarMesa(b);
          b.sala = s.id;
          b.andar = ac;
          this.configurar(b, area, k, mudouSala);
        });
      }
    }
    for (const b of this.lista) if (!vistos.has(b.id)) b.sumiuEm ??= agora;
    this.expirar(agora);
  }

  /** Tira da cena quem sumiu do snapshot há mais de SUMIR_MS. */
  expirar(agora: number): void {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const b = this.lista[i]!;
      if (b.sumiuEm === undefined || agora - b.sumiuEm <= SUMIR_MS) continue;
      this.soltarMesa(b);
      if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
      this.porId.delete(b.id);
      this.lista.splice(i, 1);
    }
  }

  passo(dt: number, agora: number, pf: PathFinder, rnd: () => number): void {
    for (const b of this.lista) this.passoBoneco(b, dt, agora, pf, rnd);
  }

  private soltarMesa(b: Boneco): void {
    if (!b.mesa) return;
    this.ocupados.delete(b.mesa.id);
    if (this.porMesa.get(b.mesa.id) === b) this.porMesa.delete(b.mesa.id);
    b.mesa = undefined;
  }

  private escolherMesa(area: AreaLayout | undefined, k: number): SpotDef | undefined {
    if (!area) return undefined;
    const mesas = area.spots.filter((s) => s.kind === 'desk');
    for (let i = k; i < k + ORDEM_MESA.length; i++) {
      const want = ORDEM_MESA[i % ORDEM_MESA.length]!;
      const s = mesas.find((m) => area.furniture.find((f) => f.id === m.deskId)?.seat === want && !this.ocupados.has(m.id));
      if (s) return s;
    }
    return mesas.find((m) => !this.ocupados.has(m.id));
  }

  /** Pose, lugar e modo conforme o estado do ocupante. `novo`: põe o boneco direto no lugar (sem andar até lá). */
  private configurar(b: Boneco, area: AreaLayout | undefined, k: number, novo: boolean): void {
    const o = b.o;
    const estavaSentado = b.seated;
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    b.alvo = undefined;
    b.path = [];
    b.pi = 0;
    b.esperaAte = 0;
    b.icone = undefined;
    b.held = 'none';
    if (b.sala === 'recepcao' || b.andar.id === 'terreo') {
      // personas: conversando (celular) ou passeando pela recepção
      this.soltarMesa(b);
      const sp = area?.spots.filter((x) => RECEPCAO.has(x.kind)).find((x) => !this.ocupados.has(x.id));
      if (sp) this.ocupados.add(sp.id);
      b.alvo = sp;
      b.modo = o.estado === 'conversando' ? 'fixo' : 'passeia';
      if (sp) Object.assign(b, { x: sp.x, y: sp.y, dir: sp.dir, seated: !!sp.seated });
      b.pose = o.estado === 'conversando' ? 'talk' : sp?.seated ? 'sit' : 'stand';
      b.held = o.estado === 'conversando' ? 'phone' : 'none';
      b.icone = o.estado === 'conversando' ? 'chat' : undefined;
      return;
    }
    if (!b.mesa) {
      b.mesa = this.escolherMesa(area, k);
      if (b.mesa) {
        this.ocupados.add(b.mesa.id);
        this.porMesa.set(b.mesa.id, b);
      }
      novo = true;
    }
    const sentado = o.perfil === 'victor' || o.estado === 'running' || o.estado === 'blocked' || o.estado === 'guarded';
    if (sentado) {
      // senta na mesa (de onde estiver: a S8 fará ele andar até lá)
      if (b.mesa) Object.assign(b, { x: b.mesa.x, y: b.mesa.y, dir: b.mesa.dir });
      b.modo = 'mesa';
      b.seated = true;
      if (o.perfil === 'victor') {
        b.pose = o.estado === 'blocked' ? 'raise_hand' : 'read';
        b.held = o.estado === 'blocked' ? 'none' : 'papers';
        b.icone = o.estado === 'blocked' ? 'alert' : undefined;
      } else if (o.estado === 'running') b.pose = 'type';
      else if (o.estado === 'blocked') {
        b.pose = 'raise_hand';
        b.icone = 'alert';
      } else {
        b.pose = 'sulk';
        b.icone = 'storm';
      }
      return;
    }
    if (novo && b.mesa) Object.assign(b, { x: b.mesa.x, y: b.mesa.y, dir: b.mesa.dir });
    // levanta: fica em pé ao lado da mesa
    if ((novo || estavaSentado) && b.mesa) b.y = b.mesa.y + (b.mesa.dir === 'down' ? -2 : 2);
    b.seated = false;
    b.pose = 'stand';
    if (o.estado === 'delivering') {
      b.modo = 'entrega';
      b.held = 'box';
      b.icone = 'box';
    } else b.modo = 'passeia';
  }

  private irPara(b: Boneco, pf: PathFinder, grid: WalkGrid, tx: number, ty: number): boolean {
    let sx = Math.floor(b.x / TILE);
    let sy = Math.floor((b.y - 4) / TILE);
    if (!grid.walkable(sx, sy)) {
      const n = grid.nearestWalkable(sx, sy, 3);
      if (n) [sx, sy] = [n.x, n.y];
    }
    const out: number[] = [];
    if (!pf.find(sx, sy, tx, ty, out) || !out.length) return false;
    b.path = out;
    b.pi = 0;
    b.seated = false;
    b.pose = 'walk';
    return true;
  }

  private passoBoneco(b: Boneco, dt: number, agora: number, pf: PathFinder, rnd: () => number): void {
    if (b.modo === 'mesa' || b.modo === 'fixo') return;
    const cena = this.cena;
    if (b.pi < b.path.length) {
      const gx = b.path[b.pi]! * TILE + TILE / 2;
      const gy = b.path[b.pi + 1]! * TILE + 11;
      const dx = gx - b.x;
      const dy = gy - b.y;
      const d = Math.hypot(dx, dy);
      const step = SPEED * dt;
      if (Math.abs(dx) > Math.abs(dy)) b.dir = dx > 0 ? 'right' : 'left';
      else if (d > 0.5) b.dir = dy > 0 ? 'down' : 'up';
      if (d <= step) {
        b.x = gx;
        b.y = gy;
        b.pi += 2;
        if (b.pi >= b.path.length) {
          const a = b.alvo;
          if (a) {
            b.x = a.x;
            b.y = a.y;
            b.dir = a.dir;
            b.seated = !!a.seated;
          }
          b.pose = this.pouso(b);
          b.esperaAte = agora + 3500 + rnd() * 5000;
        }
      } else {
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
      }
      return;
    }
    if (agora < b.esperaAte) return;
    // escolhe o próximo destino
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    b.alvo = undefined;
    let alvo: SpotDef | undefined;
    if (b.modo === 'entrega') {
      // vai e volta entre a mesa e o corredor do andar, com a caixa
      const corr = b.andar.areas.find((a) => a.kind === 'corridor' && !a.id.startsWith('hall:'));
      const naMesa = b.mesa && Math.abs(b.x - b.mesa.x) < 20 && Math.abs(b.y - b.mesa.y) < 20;
      if (naMesa && corr) {
        const tx = corr.rect.x + 2 + Math.floor(rnd() * (corr.rect.w - 4));
        if (this.irPara(b, pf, cena.grid, tx, corr.rect.y + 2)) b.held = 'box';
        b.esperaAte = 0;
        return;
      }
      alvo = b.mesa;
    } else {
      const opcoes = b.andar.passeio.flatMap((a) => a.spots).filter((s) => PASSEIO.has(s.kind) && !this.ocupados.has(s.id) && cena.grid.walkable(s.tx, s.ty));
      const sala = b.mesa ? cena.andar(b.andar, b.mesa.areaId) : undefined;
      const proprias = sala?.spots.filter((s) => (s.kind === 'whiteboard' || s.kind === 'stand') && !this.ocupados.has(s.id)) ?? [];
      const todas = [...opcoes, ...proprias];
      alvo = todas[Math.floor(rnd() * todas.length)];
    }
    if (!alvo) {
      b.esperaAte = agora + 2000;
      return;
    }
    // a própria mesa já está reservada para ele; os outros lugares, só enquanto ele está lá
    if (alvo !== b.mesa) this.ocupados.add(alvo.id);
    b.alvo = alvo;
    if (!this.irPara(b, pf, cena.grid, alvo.tx, alvo.ty)) {
      if (alvo !== b.mesa) this.ocupados.delete(alvo.id);
      b.alvo = undefined;
      b.esperaAte = agora + 1500;
    }
  }

  private pouso(b: Boneco): Pose {
    if (b.modo === 'entrega') {
      b.held = 'box';
      return 'stand';
    }
    const k = b.alvo?.kind;
    b.held = 'none';
    b.icone = undefined;
    if (k === 'coffee' || k === 'snack' || k === 'fridge' || (k === 'window' && b.seed % 2 === 0)) {
      b.held = 'coffee';
      b.icone = 'coffee';
      return 'drink';
    }
    if (k === 'water') {
      b.held = 'water';
      return 'drink';
    }
    if (k === 'talk') return 'talk';
    if (k === 'whiteboard') {
      b.held = 'papers';
      return 'read';
    }
    if (k === 'cafe_seat' || k === 'bench' || k === 'armchair') {
      b.held = 'coffee';
      b.icone = 'coffee';
      return 'sit';
    }
    return 'stand';
  }
}
