// PROTÓTIPO DESCARTÁVEL — branch prototipo/predio-vertical (nunca vai para a main).
// Cartão escritorio t_5189a13c. Pedido do Victor: "algo parecido com o mapinha das salas, mas na vertical".
// É o MESMO mapa: as mesmas salas (layoutProjectRoom), copa, recepção e corredor do client/src/world, com a
// mesma arte (buildAreaVis, móveis, telas, janelas, árvores, carros), só que montado de cima para baixo:
// Cobertura · Negócio no topo, 3º Produto, 2º TI (salas lado a lado, em quarteirões com corredor) e Térreo
// com a rua embaixo. Os personagens sentam, digitam, levantam a mão, andam até a copa e tomam café.
//   ?prototipo=predio-vertical&opcao=a → o prédio é a tela inicial; tocar num andar dá zoom (animado) nele.
//   ?prototipo=predio-vertical&opcao=b → botão Salas ⇄ Prédio no topo, lembrando a escolha.
// Dados: exemploPredio() (demonstração). Sem teste, sem persistência além da escolha da opção B.
import * as artModule from '../art';
import { TILE, type ArtModule, type Appearance, type Dir, type HeldItem, type IconName, type Pose, type ScreenMode, type Sprite } from '../art/api';
import { hash32 } from '../../../shared/hash';
import type { HermesModelo } from '../../../shared/types';
import { paintArea } from '../world/layout/building';
import { AreaBuilder } from '../world/layout/builder';
import { layoutCafe, layoutReception } from '../world/layout/core';
import { layoutCorridor } from '../world/layout/corridor';
import { EXTERIOR_WALL } from '../world/layout/exterior';
import { layoutProjectRoom } from '../world/layout/room';
import type { AreaLayout, ExteriorProp, SpotDef } from '../world/layout/types';
import { PathFinder } from '../world/path/astar';
import { WalkGrid } from '../world/path/grid';
import { carSprite, propSprite, shadowSprite } from '../world/render/props';
import { buildAreaVis, furnitureSprites, opaqueBounds, WALL_MARGIN, wallItemOrigin, wallSprites, type AreaVis, type FurnVis } from '../world/render/scene';
import { seloModelo } from '../ui/hermes-selo';
import { exemploPredio, montarPredio, ROTULO_ESTADO, type AndarId, type Ocupante, type PredioVista } from '../ui/predio-model';
import type { WorldApi } from '../world/api';

const art: ArtModule = artModule;
const FPS_MS = 1000 / 12;
const CHAVE_B = 'escritorio.prototipo.vista';
type Opcao = 'a' | 'b';

// ====================================================================== dados de demonstração

function modeloDemo(perfil: string): HermesModelo {
  const tabela: HermesModelo[] = [
    { assinatura: 'claude', rotulo: 'Claude', model: 'claude-opus-5-5', nome: 'Claude Opus 5.5', provider: 'anthropic', ocioso: true },
    { assinatura: 'codex', rotulo: 'ChatGPT', model: 'gpt-5.5', nome: 'GPT-5.5', provider: 'openai-codex', ocioso: true },
    { assinatura: 'agy-gemini', rotulo: 'Gemini', model: 'gemini-3.1-pro', nome: 'Gemini 3.1 Pro', provider: 'antigravity-agy', ocioso: true },
    { assinatura: 'grok', rotulo: 'Grok', model: 'grok-4-fast-reasoning', nome: 'Grok 4 Fast', provider: 'xai-oauth', ocioso: true },
  ];
  return tabela[hash32(perfil) % tabela.length]!;
}

function vistaDemo(): PredioVista {
  const ex = exemploPredio();
  ex.agentes.push(
    { id: 'h:produto', provider: 'hermes', name: 'produto', hermes: { board: 'produto', taskId: 't_p', title: 'Rodada 2 com o Victor', state: 'running' } },
    { id: 'h:plantao', provider: 'hermes', name: 'plantao' },
    { id: 'h:pl-infra', provider: 'hermes', name: 'pl-infra', hermes: { board: 'openinfra', taskId: 't_i', title: 'Regras do firewall', state: 'running' } },
    { id: 'h:designer', provider: 'hermes', name: 'designer', hermes: { board: 'escritorio', taskId: 't_5189a13c', title: 'Protótipo do prédio vertical', state: 'running' } },
    { id: 'h:dev2', provider: 'hermes', name: 'Nise da Silveira (dev)', hermesProfile: 'dev', hermesSlot: 2, hermes: { board: 'openhealth', taskId: 't_d2', title: 'Gráfico de pressão por semana', state: 'running' } },
  );
  const v = montarPredio(ex.agentes, ex.uso);
  for (const a of v.andares) for (const s of a.salas) for (const o of s.ocupantes) if (!o.modelo && o.perfil !== 'victor' && !s.id.startsWith('recep')) o.modelo = modeloDemo(o.perfil);
  return v;
}

// ====================================================================== selo e estado

const COR_SELO: Record<string, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  'agy-gemini': '#4c8df6',
  'agy-claude': '#a07bd8',
  grok: '#c9ced8',
  reserva: '#ff9f1c',
  outro: '#8b98b3',
};
const ROTULO_SELO: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT', 'agy-gemini': 'Gemini', 'agy-claude': 'Claude AG', grok: 'Grok', outro: 'Outro' };

const COR_ESTADO: Record<string, string> = {
  running: '#4fd18b',
  blocked: '#ffb547',
  guarded: '#ff6b6b',
  delivering: '#b69cff',
  cafe: '#aab3c5',
  conversando: '#3cd8d2',
  fora: '#aab3c5',
};

// ====================================================================== planta vertical (tiles)

const BX = 2; // margem de grama à esquerda
const BW = 32; // 2 salas de 16 tiles
const WT = BX + BW + 2;
const TOPO = 6; // gramado acima do prédio
const LAJE = 4; // faixa de tijolo entre andares (onde fica a placa do andar, alvo de toque)

type Peca = { tipo: 'sala'; id: string; nome: string } | { tipo: 'copa' } | { tipo: 'recepcao' } | { tipo: 'terraco' };
interface Bloco {
  n: [Peca, Peca];
  s?: [Peca, Peca];
}
interface AndarPlanta {
  id: AndarId;
  titulo: string;
  blocos: Bloco[];
}

interface AndarCena {
  id: AndarId;
  titulo: string;
  y0: number; // tiles (topo da laje)
  y1: number; // tiles (fim do andar)
  areas: AreaLayout[];
  /** Áreas onde quem está à toa passeia (corredor, copa, recepção). */
  passeio: AreaLayout[];
}

interface Cena {
  andares: AndarCena[];
  areas: AreaVis[];
  props: ExteriorProp[];
  grid: WalkGrid;
  alturaT: number;
  ruaY: number; // px
  salaDe: Map<string, AreaLayout>;
}

/** Copia uma área do mapa original para outro lugar (dx, dy em tiles), com ids novos. */
function mover(a: AreaLayout, dx: number, dy: number, novoId: string): AreaLayout {
  const px = dx * TILE;
  const py = dy * TILE;
  const rid = (id: string | undefined) => (id === undefined ? undefined : id.split(a.id).join(novoId));
  return {
    ...a,
    id: novoId,
    rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy },
    floors: a.floors.map((f) => ({ ...f, x: f.x + px, y: f.y + py })),
    rugs: a.rugs.map((r) => ({ ...r, x: r.x + px, y: r.y + py })),
    walls: a.walls.map((w) => (w.kind === 'cap' ? { ...w, x: w.x + px, y: w.y + py } : { ...w, x: w.x + px, y: w.y + py, doorways: w.doorways?.map((d) => ({ ...d, x: d.x + px })) })),
    wallItems: a.wallItems.map((w) => ({ ...w, id: rid(w.id)!, cx: w.cx + px, baseY: w.baseY + py })),
    furniture: a.furniture.map((f) => ({ ...f, id: rid(f.id)!, tx: f.tx + dx, ty: f.ty + dy })),
    spots: a.spots.map((s) => ({
      ...s,
      id: rid(s.id)!,
      areaId: novoId,
      tx: s.tx + dx,
      ty: s.ty + dy,
      x: s.x + px,
      y: s.y + py,
      sortY: s.sortY === undefined ? undefined : s.sortY + py,
      furnitureId: rid(s.furnitureId),
      deskId: rid(s.deskId),
      group: s.group ? `${novoId}:${s.group}` : undefined,
    })),
    walkable: a.walkable.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    blocked: a.blocked?.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    door: a.door ? { ...a.door, x: a.door.x + dx, y: a.door.y + dy } : undefined,
    shade: a.shade ? { ...a.shade, x: a.shade.x + px, y: a.shade.y + py } : undefined,
    signId: rid(a.signId),
  };
}

function plantaVertical(v: PredioVista): AndarPlanta[] {
  const sala = (andar: AndarId, id: string): Peca => {
    const s = v.andares.find((a) => a.id === andar)!.salas.find((x) => x.id === id)!;
    return { tipo: 'sala', id: s.id, nome: s.nome };
  };
  const ti = v.andares.find((a) => a.id === 'ti')!.salas.map((s) => ({ tipo: 'sala', id: s.id, nome: s.nome }) as Peca);
  const blocosTi: Bloco[] = [];
  for (let i = 0; i < ti.length; i += 4) {
    const g = ti.slice(i, i + 4);
    const par = (a?: Peca, b?: Peca): [Peca, Peca] => [a ?? { tipo: 'terraco' }, b ?? { tipo: 'terraco' }];
    blocosTi.push(g.length > 2 ? { n: par(g[0], g[1]), s: par(g[2], g[3]) } : { n: par(g[0], g[1]) });
  }
  return [
    { id: 'cobertura', titulo: 'Cobertura · Negócio', blocos: [{ n: [sala('cobertura', 'victor'), { tipo: 'terraco' }] }] },
    { id: 'produto', titulo: '3º · Produto', blocos: [{ n: [sala('produto', 'produto'), { tipo: 'copa' }] }] },
    { id: 'ti', titulo: '2º · TI', blocos: blocosTi },
    { id: 'terreo', titulo: 'Térreo · Personas', blocos: [{ n: [{ tipo: 'recepcao' }, { tipo: 'terraco' }] }] },
  ];
}

const ROOM_H = 12;
const COR_H = 5;

function terraco(id: string, x: number, y: number, sul: boolean, props: ExteriorProp[]): AreaLayout {
  const b = new AreaBuilder(id, 'lounge', { x, y, w: 16, h: ROOM_H });
  b.floor('grass', 0, 0, 16, ROOM_H, hash32(id) % 97);
  b.floor('sidewalk', 5, 3, 6, 6, 7);
  const s = hash32(id);
  const P = (kind: ExteriorProp['kind'], lx: number, ly: number, k = 0) => props.push({ kind, x: (x + lx) * TILE, y: (y + ly) * TILE, seed: s + k });
  P('tree', 2, 4, 1);
  P('pine', 14, 3, 2);
  P('parasol', 8, 6.5, 3);
  P('bench', 6.5, 9, 4);
  P('flowers', 3, 9, 5);
  P('flowers', 13, 9.5, 6);
  P('bush', 12, 6, 7);
  P('lamp', 11, 9, 8);
  // cerca viva na beira do corredor
  const yh = sul ? 1 : ROOM_H;
  for (let lx = 1; lx < 16; lx += 2) P('hedge', lx, yh, 9 + lx);
  b.walk(1, sul ? 2 : 1, 14, 9);
  return b.build();
}

function montarCena(v: PredioVista): Cena {
  const andares: AndarCena[] = [];
  const props: ExteriorProp[] = [];
  const salaDe = new Map<string, AreaLayout>();
  let y = TOPO;
  for (const ap of plantaVertical(v)) {
    const a: AndarCena = { id: ap.id, titulo: ap.titulo, y0: y, y1: 0, areas: [], passeio: [] };
    y += LAJE;
    ap.blocos.forEach((bl, bi) => {
      const linha = (pecas: [Peca, Peca], yy: number, sul: boolean) => {
        pecas.forEach((p, i) => {
          const x = BX + i * 16;
          const id = `${ap.id}:${bi}:${sul ? 's' : 'n'}${i}`;
          let area: AreaLayout;
          if (p.tipo === 'sala') {
            const seed = hash32(`sala:${p.id}`);
            const theme = art.roomTheme(seed);
            const orig = layoutProjectRoom({ id: `sala:${p.id}`, slot: sul ? 1 : 0, seed }, theme);
            area = mover(orig, x - orig.rect.x, yy - orig.rect.y, `sala:${p.id}`);
            salaDe.set(p.id, area);
          } else if (p.tipo === 'copa') {
            const orig = layoutCafe();
            area = mover(orig, x - orig.rect.x, yy - orig.rect.y, `${id}:copa`);
            a.passeio.push(area);
          } else if (p.tipo === 'recepcao') {
            const orig = layoutReception();
            area = mover(orig, x - orig.rect.x, yy - orig.rect.y, `${id}:recepcao`);
            salaDe.set('recepcao', area);
            a.passeio.push(area);
          } else area = terraco(`${id}:terraco`, x, yy, sul, props);
          a.areas.push(area);
        });
      };
      linha(bl.n, y, false);
      const cor = layoutCorridor(2);
      const corr = mover(cor, BX - cor.rect.x, y + ROOM_H - cor.rect.y, `${ap.id}:${bi}:corredor`);
      a.areas.push(corr);
      a.passeio.push(corr);
      if (bl.s) {
        linha(bl.s, y + ROOM_H + COR_H, true);
        y += ROOM_H + COR_H + ROOM_H;
      } else y += ROOM_H + COR_H;
    });
    a.y1 = y;
    andares.push(a);
  }
  const ruaY = (y + 1) * TILE;
  const alturaT = y + 1 + 2 + 4 + 5;
  // árvores nas laterais (o gramado do mapa)
  for (let ty = 2; ty < alturaT; ty += 3) {
    props.push({ kind: ty % 2 ? 'pine' : 'tree', x: 1 * TILE, y: ty * TILE + 8, seed: ty });
    props.push({ kind: ty % 2 ? 'tree' : 'pine', x: (WT - 1) * TILE, y: ty * TILE + 20, seed: ty + 3 });
  }
  for (let tx = 3; tx < WT - 2; tx += 4) props.push({ kind: tx % 8 === 3 ? 'tree' : 'bush', x: tx * TILE + 6, y: 3 * TILE + (tx % 3) * 6, seed: tx });
  for (let tx = 2; tx < WT; tx += 6) props.push({ kind: 'lamp', x: tx * TILE, y: ruaY + 2 * TILE - 2, seed: tx });
  const todas = andares.flatMap((a) => a.areas);
  const grid = new WalkGrid(WT, alturaT);
  for (const ar of todas) paintArea(grid, ar);
  return {
    andares,
    areas: todas.map((ar) => buildAreaVis(art, ar, undefined, null)),
    props,
    grid,
    alturaT,
    ruaY,
    salaDe,
    andar: (a, id) => a.areas.find((x) => x.id === id),
  };
}

// ====================================================================== personagens

interface Boneco {
  id: string;
  o: Ocupante;
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
  head: { x: number; y: number; ok: boolean };
}

const ocupados = new Set<string>();

function escolherMesa(area: AreaLayout | undefined, k: number): SpotDef | undefined {
  if (!area) return undefined;
  const mesas = area.spots.filter((s) => s.kind === 'desk');
  // espalha: N esquerda, N direita, S meio, N meio, S esquerda, S direita (rótulos não se cobrem)
  const ordem = ['N0', 'N2', 'S1', 'N1', 'S0', 'S2'];
  for (let i = k; i < k + ordem.length; i++) {
    const want = ordem[i % ordem.length]!;
    const s = mesas.find((m) => {
      const f = area.furniture.find((ff) => ff.id === m.deskId);
      return f?.seat === want && !ocupados.has(m.id);
    });
    if (s) {
      ocupados.add(s.id);
      return s;
    }
  }
  return mesas.find((m) => !ocupados.has(m.id));
}

function criarBonecos(v: PredioVista, cena: Cena): Boneco[] {
  const out: Boneco[] = [];
  for (const andar of v.andares) {
    const ac = cena.andares.find((a) => a.id === andar.id)!;
    for (const s of andar.salas) {
      const area = cena.salaDe.get(s.id);
      s.ocupantes.forEach((o, k) => {
        const seed = hash32(o.agentId ?? `${o.perfil}:${k}`);
        const b: Boneco = {
          id: o.agentId ?? `${s.id}:${o.perfil}:${k}`,
          o,
          andar: ac,
          ap: art.appearanceFromSeed(seed),
          seed,
          x: 0,
          y: 0,
          dir: 'down',
          pose: 'stand',
          held: 'none',
          seated: false,
          path: [],
          pi: 0,
          esperaAte: 0,
          modo: 'fixo',
          head: { x: 0, y: 0, ok: false },
        };
        const sentado = o.perfil === 'victor' || o.estado === 'running' || o.estado === 'blocked' || o.estado === 'guarded';
        if (s.id === 'recepcao' || andar.id === 'terreo') {
          // personas: conversando (celular) ou passeando pela recepção
          const sp = area?.spots.filter((x) => x.kind === 'talk' || x.kind === 'bench' || x.kind === 'armchair' || x.kind === 'water' || x.kind === 'elevator').find((x) => !ocupados.has(x.id));
          if (sp) ocupados.add(sp.id);
          b.alvo = sp;
          b.modo = o.estado === 'conversando' ? 'fixo' : 'passeia';
          if (sp) Object.assign(b, { x: sp.x, y: sp.y, dir: sp.dir, seated: !!sp.seated });
          b.pose = o.estado === 'conversando' ? 'talk' : sp?.seated ? 'sit' : 'stand';
          b.held = o.estado === 'conversando' ? 'phone' : 'none';
          b.icone = o.estado === 'conversando' ? 'chat' : undefined;
        } else {
          b.mesa = escolherMesa(area, k);
          if (b.mesa) Object.assign(b, { x: b.mesa.x, y: b.mesa.y, dir: b.mesa.dir });
          if (sentado) {
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
          } else if (o.estado === 'delivering') {
            b.modo = 'entrega';
            b.held = 'box';
            b.icone = 'box';
            b.seated = false;
          } else {
            b.modo = 'passeia';
            b.seated = false;
            b.esperaAte = 0;
            // começa em pé ao lado da mesa
            if (b.mesa) b.y = b.mesa.y + (b.mesa.dir === 'down' ? -2 : 2);
          }
        }
        out.push(b);
      });
    }
  }
  return out;
}

const SPEED = 3.2 * TILE; // px de mundo por segundo (o mesmo andar do mapa)

function tileDe(x: number, y: number): [number, number] {
  return [Math.floor(x / TILE), Math.floor((y - 4) / TILE)];
}

function irPara(b: Boneco, pf: PathFinder, grid: WalkGrid, tx: number, ty: number): boolean {
  let [sx, sy] = tileDe(b.x, b.y);
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

function passoBoneco(b: Boneco, dt: number, agora: number, cena: Cena, pf: PathFinder, rnd: () => number): void {
  if (b.modo === 'mesa' || b.modo === 'fixo') return;
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
        // chegou
        const a = b.alvo;
        if (a) {
          b.x = a.x;
          b.y = a.y;
          b.dir = a.dir;
          b.seated = !!a.seated;
        }
        b.pose = pousoDe(b);
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
  if (b.alvo) ocupados.delete(b.alvo.id);
  b.alvo = undefined;
  let alvo: SpotDef | undefined;
  if (b.modo === 'entrega') {
    // vai e volta entre a mesa e o corredor do andar, com a caixa
    const corr = b.andar.areas.find((a) => a.kind === 'corridor');
    const naMesa = b.mesa && Math.abs(b.x - b.mesa.x) < 20 && Math.abs(b.y - b.mesa.y) < 20;
    if (naMesa && corr) {
      const tx = corr.rect.x + 2 + Math.floor(rnd() * (corr.rect.w - 4));
      const ty = corr.rect.y + 2;
      if (irPara(b, pf, cena.grid, tx, ty)) b.held = 'box';
      b.esperaAte = 0;
      return;
    }
    alvo = b.mesa;
  } else {
    const kinds = new Set(['coffee', 'water', 'talk', 'window', 'cafe_seat', 'snack', 'bench', 'armchair', 'whiteboard', 'fridge']);
    const opcoes = b.andar.passeio
      .flatMap((a) => a.spots)
      .filter((s) => kinds.has(s.kind) && !ocupados.has(s.id) && cena.grid.walkable(s.tx, s.ty));
    const proprias = b.mesa ? cena.andar(b.andar, b.mesa.areaId)?.spots.filter((s) => (s.kind === 'whiteboard' || s.kind === 'stand') && !ocupados.has(s.id)) ?? [] : [];
    const todas = [...opcoes, ...proprias];
    alvo = todas[Math.floor(rnd() * todas.length)];
  }
  if (!alvo) {
    b.esperaAte = agora + 2000;
    return;
  }
  ocupados.add(alvo.id);
  b.alvo = alvo;
  if (!irPara(b, pf, cena.grid, alvo.tx, alvo.ty)) {
    ocupados.delete(alvo.id);
    b.alvo = undefined;
    b.esperaAte = agora + 1500;
  }
}

function pousoDe(b: Boneco): Pose {
  const k = b.alvo?.kind;
  if (b.modo === 'entrega') {
    b.held = 'box';
    return b.alvo?.kind === 'desk' ? 'stand' : 'stand';
  }
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

// helper: área pelo id (andar)
interface Cena {
  andar(a: AndarCena, areaId: string): AreaLayout | undefined;
}

// ====================================================================== desenho

interface Ent {
  y: number;
  k: 0 | 1 | 2 | 3;
  f?: FurnVis;
  vis?: AreaVis;
  b?: Boneco;
  p?: ExteriorProp;
}

function telaDaMesa(f: FurnVis, bonecos: Map<string, Boneco>): ScreenMode {
  if (!f.seatSpot) return 'standby';
  const b = bonecos.get(f.seatSpot);
  if (!b) return 'standby';
  if (b.modo !== 'mesa') return 'idle';
  if (b.o.estado === 'blocked') return 'alert';
  if (b.o.estado === 'guarded') return 'alert';
  if (b.o.perfil === 'victor') return 'docs';
  const modos: ScreenMode[] = ['code', 'terminal', 'browser', 'docs'];
  return modos[b.seed % modos.length]!;
}

function desenharCaminhao(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.fillStyle = 'rgba(20,24,34,0.25)';
  ctx.fillRect(x + 2, y + 16, 42, 3);
  ctx.fillStyle = '#2b3245';
  ctx.fillRect(x + 12, y - 2, 32, 17);
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(x + 13, y - 1, 30, 15);
  ctx.fillStyle = '#4fd18b';
  ctx.fillRect(x + 15, y + 4, 26, 4);
  ctx.fillStyle = '#2b3245';
  ctx.fillRect(x, y + 3, 13, 12);
  ctx.fillStyle = '#e8644f';
  ctx.fillRect(x + 1, y + 4, 11, 10);
  ctx.fillStyle = '#9fd4ff';
  ctx.fillRect(x + 2, y + 5, 5, 4);
  const r = Math.floor(t / 110) % 2;
  for (const rx of [x + 3, x + 18, x + 36]) {
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(rx, y + 13, 6, 5);
    ctx.fillStyle = '#8b93a5';
    ctx.fillRect(rx + 1 + r * 2, y + 14, 2, 2);
  }
  ctx.fillStyle = 'rgba(210,214,222,0.75)';
  const f = Math.floor(t / 160) % 3;
  ctx.fillRect(x + 46 + f * 2, y + 12 - f, 3, 3);
}

// ====================================================================== DOM

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function nomeCurto(o: Ocupante): string {
  return o.nome.replace(/\s*\((dev|devcodex|devgemini)\)$/, '').split(' ')[0]!;
}

interface Rotulo {
  b: Boneco;
  el: HTMLElement;
  estado: HTMLElement;
  w: number;
  h: number;
}

function criarRotulo(b: Boneco): Rotulo {
  const r = el('div', `pv-rot pv-rot--${b.o.estado}`);
  const nome = el('span', 'pv-rot__nome');
  const dot = el('i', 'pv-dot');
  dot.style.background = COR_ESTADO[b.o.estado] ?? '#aab3c5';
  nome.append(dot, el('span', 'pv-rot__txt', nomeCurto(b.o)));
  r.append(nome);
  if (b.o.modelo) {
    const sel = seloModelo(b.o.modelo);
    const chave = b.o.modelo.reserva ? 'reserva' : b.o.modelo.assinatura;
    const s = el('span', `pv-selo${b.o.modelo.reserva ? ' pv-selo--reserva' : ''}`, b.o.modelo.reserva ? '↪ reserva' : ROTULO_SELO[chave] ?? sel.texto);
    s.style.setProperty('--c', COR_SELO[chave] ?? '#8b98b3');
    s.title = sel.titulo;
    r.append(s);
  } else if (b.o.perfil === 'victor' && b.o.estado === 'blocked') {
    r.append(el('span', 'pv-selo pv-selo--portao', 'portão'));
  }
  const est = el('span', 'pv-rot__est', b.o.perfil === 'victor' ? (b.o.estado === 'blocked' ? 'precisa de você' : 'nada esperando') : ROTULO_ESTADO[b.o.estado]);
  r.append(est);
  r.title = [b.o.nome, ROTULO_ESTADO[b.o.estado], b.o.detalhe].filter(Boolean).join(' · ');
  return { b, el: r, estado: est, w: 0, h: 0 };
}

// ====================================================================== montagem

export function montarPrototipo(opts: { root: HTMLElement; topbar: HTMLElement; world: WorldApi }): void {
  const q = protoParams();
  const opcao: Opcao = q.get('opcao') === 'b' ? 'b' : 'a';
  document.documentElement.classList.add('pv-on');
  injetarCss();
  const vista = vistaDemo();
  const cena = montarCena(vista);
  cena.andar = (a, id) => a.areas.find((x) => x.id === id);
  const pf = new PathFinder(cena.grid);
  const bonecos = criarBonecos(vista, cena);
  const porMesa = new Map<string, Boneco>();
  for (const b of bonecos) if (b.mesa) porMesa.set(b.mesa.id, b);
  let semente = 12345;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) >>> 0) / 0xffffffff);
  const WPX = WT * TILE;
  const HPX = cena.alturaT * TILE;
  const deployRodando = bonecos.some((b) => b.o.perfil === 'deployer' && b.o.estado === 'running');

  // ---------------- faixa do protótipo
  const faixa = el('nav', 'pv-faixa');
  faixa.setAttribute('aria-label', 'Protótipo: escolher opção');
  faixa.append(el('span', 'pv-faixa__tit', 'Protótipo'));
  for (const o of ['a', 'b'] as const) {
    const a = el('a', `pv-faixa__op${o === opcao ? ' is-on' : ''}`, `Opção ${o.toUpperCase()}`);
    a.href = `#opcao=${o}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = `opcao=${o}`;
      location.reload();
    });
    if (o === opcao) a.setAttribute('aria-current', 'page');
    faixa.append(a);
  }
  document.body.append(faixa);

  // ---------------- cena (canvas preso à janela + palco do tamanho do mundo)
  const camada = el('div', 'pv-camada');
  camada.setAttribute('role', 'region');
  camada.setAttribute('aria-label', 'Prédio do time (mapa vertical)');
  const palco = el('div', 'pv-palco');
  const tela = document.createElement('canvas');
  tela.className = 'pv-tela';
  tela.setAttribute('aria-hidden', 'true');
  const camRot = el('div', 'pv-rotulos');
  palco.append(tela, camRot);
  camada.append(palco);
  opts.root.append(camada);

  // rótulos dos andares (alvo de toque na opção A)
  const placasAndar = cena.andares.map((a) => {
    const pl = el('button', 'pv-andar');
    pl.type = 'button';
    const n = vista.andares.find((x) => x.id === a.id)!;
    const gente = n.salas.flatMap((s) => s.ocupantes);
    const trab = gente.filter((o) => o.estado === 'running').length;
    const mao = gente.filter((o) => o.estado === 'blocked').length;
    pl.append(el('span', 'pv-andar__tit', a.titulo));
    void mao;
    const resumo = a.id === 'terreo' ? `${gente.filter((o) => o.estado === 'conversando').length} conversando` : a.id === 'cobertura' ? (vista.portoes ? `✋ ${vista.portoes} portão` : 'nada esperando') : `${trab} trabalhando${mao ? ` · ✋ ${mao}` : ''}`;
    pl.append(el('span', `pv-andar__n${a.id === 'cobertura' && vista.portoes ? ' pv-andar__n--mao' : ''}`, resumo));
    camRot.append(pl);
    return { a, el: pl };
  });
  // nomes das salas (na face da parede)
  const placasSala: { area: AreaLayout; el: HTMLElement }[] = [];
  for (const a of cena.andares)
    for (const ar of a.areas) {
      let nome: string | null = null;
      if (ar.id.startsWith('sala:')) nome = vista.andares.flatMap((x) => x.salas).find((s) => `sala:${s.id}` === ar.id)?.nome ?? null;
      else if (ar.id.endsWith(':copa')) nome = 'Copa';
      else if (ar.id.endsWith(':terraco')) nome = 'Terraço';
      if (ar.id === 'sala:recepcao' || ar.id.endsWith(':recepcao')) nome = 'Recepção';
      if (!nome) continue;
      const e = el('span', 'pv-sala', nome);
      camRot.append(e);
      placasSala.push({ area: ar, el: e });
    }
  const rotulos = bonecos.map((b) => {
    const r = criarRotulo(b);
    camRot.append(r.el);
    return r;
  });

  // ---------------- câmera: escala e rolagem nativa
  let escala = 1;
  let detalhe = false;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const escalaVisao = () => {
    const w = camada.clientWidth;
    return Math.max(0.5, Math.min(1.5, w / WPX));
  };
  const largPalco = () => Math.max(camada.clientWidth, Math.round(WPX * escala));
  const offX = () => Math.round((largPalco() - WPX * escala) / 2);
  const aplicarEscala = (s: number) => {
    escala = s;
    palco.style.width = `${largPalco()}px`;
    palco.style.height = `${Math.round(HPX * escala)}px`;
    camada.classList.toggle('pv-camada--detalhe', detalhe);
    posicionarFixos();
  };
  const posicionarFixos = () => {
    const ox = offX();
    for (const p of placasAndar) {
      p.el.style.left = `${Math.round(Math.max(ox + BX * TILE * escala + 4, camada.scrollLeft + 8))}px`;
      p.el.style.top = `${Math.round(p.a.y0 * TILE * escala + (LAJE * TILE * escala) / 2)}px`;
    }
    for (const p of placasSala) {
      p.el.style.left = `${Math.round(ox + (p.area.rect.x + 1) * TILE * escala)}px`;
      p.el.style.top = `${Math.round((p.area.rect.y + p.area.rect.h - 1.6) * TILE * escala)}px`;
    }
  };
  /** Zoom com âncora: o ponto de mundo (wx, wy) fica sob o ponto de tela (sx, sy). */
  const zoomPara = (alvo: number, wx: number, wy: number, sx: number, sy: number, ms = 380) => {
    const ini = escala;
    const t0 = performance.now();
    const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const passo = (agora: number) => {
      const u = reduz ? 1 : Math.min(1, (agora - t0) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      aplicarEscala(ini + (alvo - ini) * e);
      camada.scrollLeft = offX() + wx * escala - sx;
      camada.scrollTop = wy * escala - sy;
      desenhar(agora);
      if (u < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };

  // ---------------- desenho por quadro
  const ents: Ent[] = [];
  const desenhar = (agora: number) => {
    const W = camada.clientWidth;
    const H = camada.clientHeight;
    const d = dpr();
    if (tela.width !== Math.round(W * d) || tela.height !== Math.round(H * d)) {
      tela.width = Math.round(W * d);
      tela.height = Math.round(H * d);
      tela.style.width = `${W}px`;
      tela.style.height = `${H}px`;
    }
    const ctx = tela.getContext('2d', { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#76a35c';
    ctx.fillRect(0, 0, tela.width, tela.height);
    const sl = camada.scrollLeft;
    const st = camada.scrollTop;
    const ox = offX();
    const s = escala * d;
    ctx.setTransform(s, 0, 0, s, (ox - sl) * d, -st * d);
    const vx0 = (sl - ox) / escala;
    const vy0 = st / escala;
    const vx1 = vx0 + W / escala;
    const vy1 = vy0 + H / escala;
    const vis = (x: number, y: number, w: number, h: number) => x < vx1 && x + w > vx0 && y < vy1 && y + h > vy0;
    // gramado (o mesmo piso do mapa) cobrindo o que se vê
    const gx0 = Math.floor(vx0 / TILE) * TILE - TILE;
    const gy0 = Math.max(0, Math.floor(vy0 / TILE) * TILE - TILE);
    art.drawFloor(ctx, 'grass', gx0, gy0, Math.ceil((vx1 - gx0) / TILE + 2) * TILE, Math.ceil((vy1 - gy0) / TILE + 2) * TILE, { seed: 11 });
    // calçada e rua
    const ry = cena.ruaY;
    art.drawFloor(ctx, 'sidewalk', gx0, ry, Math.ceil((vx1 - gx0) / TILE + 2) * TILE, 2 * TILE, { seed: 3 });
    art.drawFloor(ctx, 'street', gx0, ry + 2 * TILE, Math.ceil((vx1 - gx0) / TILE + 2) * TILE, 4 * TILE, { seed: 3 });
    ctx.fillStyle = 'rgba(255,236,170,0.75)';
    for (let x = Math.floor(gx0 / 24) * 24; x < vx1; x += 24) ctx.fillRect(x, ry + 4 * TILE - 1, 12, 2);
    // lajes entre os andares (tijolo da fachada)
    for (const a of cena.andares) {
      const y = a.y0 * TILE;
      if (!vis(BX * TILE - 8, y, BW * TILE + 16, LAJE * TILE)) continue;
      art.drawWallTop(ctx, BX * TILE - 4, y, BW * TILE + 8, LAJE * TILE, EXTERIOR_WALL);
      ctx.fillStyle = 'rgba(30,34,48,0.35)';
      ctx.fillRect(BX * TILE - 4, y + LAJE * TILE - 2, BW * TILE + 8, 2);
    }
    // telhado (antena e caixa d'água)
    {
      const y = cena.andares[0]!.y0 * TILE;
      ctx.fillStyle = '#6b7385';
      ctx.fillRect((BX + 26) * TILE, y - 22, 2, 22);
      ctx.fillStyle = Math.floor(agora / 700) % 2 ? '#ff6b6b' : '#7a2e2e';
      ctx.fillRect((BX + 26) * TILE - 2, y - 26, 6, 4);
      ctx.fillStyle = '#8b93a5';
      ctx.fillRect((BX + 4) * TILE, y - 14, 28, 14);
      ctx.fillStyle = '#a9b1c2';
      ctx.fillRect((BX + 4) * TILE + 2, y - 12, 24, 3);
    }
    // áreas: piso e paredes
    const hora = new Date().getHours() + new Date().getMinutes() / 60;
    for (const a of cena.areas) if (vis(a.px.x, a.px.y - WALL_MARGIN, a.px.w, a.px.h + WALL_MARGIN)) ctx.drawImage(a.floor, a.px.x, a.px.y);
    for (const a of cena.areas) {
      if (!vis(a.px.x, a.px.y - WALL_MARGIN, a.px.w, a.px.h + WALL_MARGIN)) continue;
      ctx.drawImage(a.walls, a.px.x, a.px.y - WALL_MARGIN);
      for (const w of a.wallItems) {
        const sp = wallSprites(art, w.kind, w.variant, w.kind === 'light_switch' ? 0 : 0, w.seed);
        if (!sp) continue;
        const o = wallItemOrigin(w, sp.base);
        if (w.kind === 'window') {
          const r = sp.base.rects?.glass;
          if (r) art.drawWindowView(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, hora, agora, w.seed);
        }
        ctx.drawImage(sp.base.canvas, o.x, o.y);
        if (w.kind === 'whiteboard' && sp.base.rects?.board) {
          const r = sp.base.rects.board;
          art.drawBoard(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }, { status: 'completed' }], agora);
        }
        if (w.kind === 'clock' && sp.base.rects?.face) {
          const r = sp.base.rects.face;
          art.drawClock(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, new Date());
        }
      }
      if (a.sign) {
        const sp = wallSprites(art, 'sign', a.sign.variant, 0, a.sign.seed);
        if (sp) {
          const o = wallItemOrigin(a.sign, sp.base);
          ctx.drawImage(sp.base.canvas, o.x, o.y);
        }
      }
    }
    // entidades por profundidade
    ents.length = 0;
    for (const a of cena.areas) {
      if (!vis(a.px.x - TILE, a.px.y - 3 * TILE, a.px.w + 2 * TILE, a.px.h + 4 * TILE)) continue;
      for (const f of a.furniture) {
        ents.push({ y: f.ay, k: 0, f, vis: a });
        const fs = furnitureSprites(art, f, 0);
        if (fs?.front) ents.push({ y: f.ay + 0.5, k: 1, f, vis: a });
      }
    }
    for (const b of bonecos) {
      if (!vis(b.x - 24, b.y - 48, 48, 60)) {
        b.head.ok = false;
        continue;
      }
      const sortY = b.seated && (b.alvo?.sortY ?? b.mesa?.sortY) !== undefined && (b.modo === 'mesa' || b.pi >= b.path.length) ? (b.modo === 'mesa' ? b.mesa!.sortY! : b.alvo?.sortY ?? b.y) : b.y;
      ents.push({ y: sortY, k: 2, b });
    }
    for (const p of cena.props) if (vis(p.x - 24, p.y - 60, 48, 64)) ents.push({ y: p.y, k: 3, p });
    ents.sort((a, b) => a.y - b.y || a.k - b.k);
    for (const e of ents) {
      if (e.k === 0 || e.k === 1) {
        const f = e.f!;
        const fs = furnitureSprites(art, f, f.kind === 'coffee_machine' ? Math.floor(agora / 4000) % 2 : 0);
        const sp = e.k === 1 ? fs?.front : fs?.base;
        if (!sp) continue;
        const dx = Math.round(f.ax - sp.ax);
        const dy = Math.round(f.ay - sp.ay);
        ctx.drawImage(sp.canvas, dx, dy);
        if (e.k === 0 && f.kind === 'desk' && sp.rects?.screen) {
          const r = sp.rects.screen;
          art.drawScreen(ctx, { x: dx + r.x, y: dy + r.y, w: r.w, h: r.h }, telaDaMesa(f, porMesa), agora, f.seed);
        }
      } else if (e.k === 2) {
        const b = e.b!;
        const x = Math.round(b.x);
        const y = Math.round(b.y);
        if (!b.seated) {
          const sh = shadowSprite();
          ctx.drawImage(sh.canvas, x - sh.ax, y - sh.ay);
        }
        const n = art.poseFrameCount(b.pose);
        const frame = Math.floor(agora / art.poseFrameDuration(b.pose) + (b.seed % 7)) % n;
        let sp: Sprite | null = null;
        try {
          sp = art.characterSprite({ appearance: b.ap, dir: b.dir, pose: b.pose, frame, held: b.held, seated: b.seated });
        } catch {
          sp = null;
        }
        if (!sp) continue;
        const sx = x - sp.ax;
        const sy = y - sp.ay;
        ctx.drawImage(sp.canvas, sx, sy);
        const bb = opaqueBounds(sp.canvas);
        b.head = { x, y: sy + bb.y, ok: true };
      } else {
        const p = e.p!;
        const s2 = propSprite(p);
        ctx.drawImage(s2.canvas, Math.round(p.x - s2.ax), Math.round(p.y - s2.ay));
      }
    }
    // ícones sobre a cabeça
    for (const b of bonecos) {
      if (!b.head.ok || !b.icone) continue;
      if (b.pose === 'walk' && b.icone === 'coffee') continue;
      const ic = art.iconSprite(b.icone);
      const pula = Math.round(Math.sin(agora / 260 + b.seed) * 1.5);
      ctx.drawImage(ic.canvas, Math.round(b.head.x + 5), Math.round(b.head.y - ic.canvas.height - 1 + pula));
    }
    // rua: carros e o caminhão do deployer saindo
    {
      const ciclo = 11000;
      const u = (agora % ciclo) / ciclo;
      const car = carSprite(2, false);
      const cx = WPX + 40 - u * (WPX + 120);
      ctx.drawImage(car.canvas, Math.round(cx - car.ax), Math.round(ry + 3 * TILE - car.ay));
      const car2 = carSprite(4, true);
      const cx2 = -60 + ((u + 0.45) % 1) * (WPX + 120);
      ctx.drawImage(car2.canvas, Math.round(cx2 - car2.ax), Math.round(ry + 5 * TILE + 4 - car2.ay));
      if (deployRodando) {
        const c2 = 9000;
        const v2 = (agora % c2) / c2;
        // sai da garagem do térreo e segue para a esquerda
        const tx = (BX + 24) * TILE - v2 * (WPX + 80);
        desenharCaminhao(ctx, Math.round(tx), Math.round(ry + 2 * TILE + 5), agora);
      }
    }
    // portão da garagem do deployer na calçada
    ctx.fillStyle = '#3a4258';
    ctx.fillRect((BX + 22) * TILE, ry - 4, 4 * TILE, 4);
    // rótulos (DOM) seguem as cabeças; a placa do andar acompanha a rolagem lateral
    posicionarFixos();
    posicionarRotulos();
  };

  const posicionarRotulos = () => {
    const ox = offX();
    const W = camada.clientWidth;
    const st = camada.scrollTop;
    const H = camada.clientHeight;
    const postos: { x: number; y: number; w: number; h: number }[] = [];
    for (const p of [...placasSala.map((x) => x.el), ...placasAndar.map((x) => x.el)]) {
      const x = parseFloat(p.style.left) || 0;
      const y = parseFloat(p.style.top) || 0;
      const h = p.offsetHeight;
      const ehAndar = p.classList.contains('pv-andar');
      postos.push({ x, y: ehAndar ? y - h / 2 : y, w: p.offsetWidth, h });
    }
    // ordem: quem está sentado primeiro (fica no lugar); quem anda se desvia
    const ordem = [...rotulos].sort((a, b) => Number(b.b.modo === 'mesa') - Number(a.b.modo === 'mesa') || a.b.y - b.b.y);
    for (const r of ordem) {
      const b = r.b;
      const sx = ox + b.head.x * escala;
      const sy = b.head.y * escala;
      if (!b.head.ok || sy < st - 60 || sy > st + H + 60) {
        r.el.style.visibility = 'hidden';
        continue;
      }
      r.el.style.visibility = 'visible';
      if (!r.w) {
        r.w = r.el.offsetWidth;
        r.h = r.el.offsetHeight;
      }
      const w = r.el.offsetWidth;
      const h = r.el.offsetHeight;
      let x = Math.round(sx - w / 2);
      let y = Math.round(sy - h - 4 - (b.icone ? 6 : 0));
      x = Math.max(ox + 2, Math.min(x, ox + WPX * escala - w - 2, Math.max(W, palco.clientWidth) - w - 2));
      // desvia de rótulos já postos: tenta acima, depois embaixo dos pés
      const bate = (yy: number) => postos.some((p) => x < p.x + p.w + 2 && x + w + 2 > p.x && yy < p.y + p.h + 1 && yy + h + 1 > p.y);
      if (bate(y)) {
        const pes = Math.round(b.y * escala + 2);
        if (!bate(pes)) y = pes;
        else {
          let tent = y;
          for (let i = 0; i < 6 && bate(tent); i++) tent -= h + 2;
          y = tent;
        }
      }
      postos.push({ x, y, w, h });
      r.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  };

  // ---------------- simulação
  let ultimo = performance.now();
  let ultDesenho = 0;
  const loop = (agora: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (agora - ultimo) / 1000);
    ultimo = agora;
    for (const b of bonecos) passoBoneco(b, dt, agora, cena, pf, rnd);
    if (camada.hidden || agora - ultDesenho < FPS_MS) return;
    ultDesenho = agora;
    desenhar(agora);
  };
  camada.addEventListener('scroll', () => desenhar(performance.now()), { passive: true });

  // arrastar com o mouse (no toque, a rolagem nativa já faz)
  let arr: { x: number; y: number; sl: number; st: number; moveu: boolean } | null = null;
  camada.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button')) return;
    arr = { x: e.clientX, y: e.clientY, sl: camada.scrollLeft, st: camada.scrollTop, moveu: false };
  });
  addEventListener('pointermove', (e) => {
    if (!arr) return;
    const dx = e.clientX - arr.x;
    const dy = e.clientY - arr.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) arr.moveu = true;
    camada.scrollLeft = arr.sl - dx;
    camada.scrollTop = arr.st - dy;
  });
  let arrastou = false;
  addEventListener('pointerup', () => {
    arrastou = !!arr?.moveu;
    arr = null;
  });

  const andarEm = (wy: number) => cena.andares.find((a) => wy >= a.y0 * TILE && wy < a.y1 * TILE);
  const mundoDe = (cx: number, cy: number) => {
    const r = camada.getBoundingClientRect();
    const sx = cx - r.left;
    const sy = cy - r.top;
    return { sx, sy, wx: (camada.scrollLeft + sx - offX()) / escala, wy: (camada.scrollTop + sy) / escala };
  };

  const posicionar = () => {
    const base = opts.root.getBoundingClientRect().top;
    const b = opts.topbar.getBoundingClientRect().bottom - base;
    camada.style.top = `${Math.round(b)}px`;
    if (nav) nav.style.top = `${Math.round(b)}px`;
    if (alternador) alternador.style.top = `${Math.round(b) + 8}px`;
    if (zoomBtns) zoomBtns.style.bottom = '16px';
  };

  let nav: HTMLElement | null = null;
  let alternador: HTMLElement | null = null;
  let zoomBtns: HTMLElement | null = null;

  // ================= opção A: o prédio é a tela inicial; tocar num andar dá zoom
  if (opcao === 'a') {
    nav = el('div', 'pv-nav');
    nav.hidden = true;
    const volta = el('button', 'pv-btn', '‹ Prédio');
    volta.type = 'button';
    const tit = el('span', 'pv-nav__tit');
    const sobe = el('button', 'pv-btn pv-btn--ic', '▲');
    sobe.type = 'button';
    sobe.setAttribute('aria-label', 'Andar de cima');
    const desce = el('button', 'pv-btn pv-btn--ic', '▼');
    desce.type = 'button';
    desce.setAttribute('aria-label', 'Andar de baixo');
    nav.append(volta, tit, sobe, desce);
    opts.root.append(nav);
    let atual = 0;
    const visao = () => {
      detalhe = false;
      nav!.hidden = true;
      camada.classList.remove('pv-camada--nav');
      const a = cena.andares[atual]!;
      zoomPara(escalaVisao(), WPX / 2, a.y0 * TILE, camada.clientWidth / 2, 80);
    };
    const irAndar = (i: number, wx?: number, wy?: number, sx?: number, sy?: number) => {
      atual = Math.max(0, Math.min(cena.andares.length - 1, i));
      const a = cena.andares[atual]!;
      detalhe = true;
      nav!.hidden = false;
      camada.classList.add('pv-camada--nav');
      tit.textContent = a.titulo;
      sobe.disabled = atual === 0;
      desce.disabled = atual === cena.andares.length - 1;
      const ev = escalaVisao();
      const alvo = ev >= 1 ? Math.min(2.5, camada.clientWidth / ((BW + 1) * TILE)) : Math.min(2.5, ev * 2);
      // no PC o andar inteiro cabe na largura; no celular, o lado tocado fica sob o dedo. O piso do andar vai para o topo.
      const largo = ev >= 1 || sx === undefined;
      // celular: mostra inteira a sala do lado tocado (esquerda encosta na borda esquerda; direita, na direita)
      const direita = !largo && wx! > (BX + BW / 2) * TILE;
      const ax = largo || !direita ? BX * TILE - 8 : (BX + BW) * TILE + 8;
      const asx = largo || !direita ? 0 : camada.clientWidth;
      zoomPara(alvo, ax, (a.y0 + LAJE) * TILE - 6, asx, 60);
      void wy;
      void sy;
    };
    volta.addEventListener('click', visao);
    sobe.addEventListener('click', () => irAndar(atual - 1));
    desce.addEventListener('click', () => irAndar(atual + 1));
    camada.addEventListener('click', (e) => {
      if (arrastou) return;
      const m = mundoDe(e.clientX, e.clientY);
      const btn = (e.target as HTMLElement).closest('.pv-andar') as HTMLElement | null;
      const pa = btn ? placasAndar.find((p) => p.el === btn)?.a : andarEm(m.wy);
      if (!pa) return;
      if (detalhe && !btn) return; // já no zoom: o toque não muda nada (role para andar pelo andar)
      irAndar(cena.andares.indexOf(pa), btn ? undefined : m.wx, btn ? undefined : m.wy, btn ? undefined : m.sx, btn ? undefined : m.sy);
    });
    // atalho para o mapa dos projetos (o de hoje)
    const mapa = el('button', 'pv-btn pv-mapa', 'Salas dos projetos');
    mapa.type = 'button';
    camRot.append(mapa);
    const volPredio = el('button', 'pv-btn pv-flutua', '‹ Prédio');
    volPredio.type = 'button';
    volPredio.hidden = true;
    opts.root.append(volPredio);
    mapa.addEventListener('click', (e) => {
      e.stopPropagation();
      camada.hidden = true;
      nav!.hidden = true;
      volPredio.hidden = false;
      volPredio.style.top = `${Math.round(opts.topbar.getBoundingClientRect().bottom - opts.root.getBoundingClientRect().top) + 8}px`;
      opts.world.overview();
    });
    volPredio.addEventListener('click', () => {
      volPredio.hidden = true;
      camada.hidden = false;
      if (detalhe) nav!.hidden = false;
      desenhar(performance.now());
    });
    const posMapa = () => {
      mapa.style.left = `${Math.round(offX() + (WPX * escala) / 2 - mapa.offsetWidth / 2)}px`;
      mapa.style.top = `${Math.round(cena.ruaY * escala + 6 * TILE * escala + 8)}px`;
    };
    const ap0 = aplicarEscala;
    void ap0;
    new ResizeObserver(posMapa).observe(palco);
    aplicarEscala(escalaVisao());
    posMapa();
    if (q.get('andar')) {
      const i = cena.andares.findIndex((a) => a.id === q.get('andar'));
      if (i >= 0) {
        atual = i;
        setTimeout(() => irAndar(i), 50);
      }
    }
  } else {
    // ================= opção B: botão Salas ⇄ Prédio (lembrado); no Prédio, + e − de zoom
    alternador = el('div', 'pv-alterna');
    alternador.setAttribute('role', 'group');
    alternador.setAttribute('aria-label', 'Vista');
    const bS = el('button', 'pv-alterna__op', 'Salas');
    const bP = el('button', 'pv-alterna__op', 'Prédio');
    bS.type = 'button';
    bP.type = 'button';
    alternador.append(bS, bP);
    opts.root.append(alternador);
    zoomBtns = el('div', 'pv-zoom');
    const mais = el('button', 'pv-btn pv-btn--ic', '+');
    mais.type = 'button';
    mais.setAttribute('aria-label', 'Aproximar');
    const menos = el('button', 'pv-btn pv-btn--ic', '−');
    menos.type = 'button';
    menos.setAttribute('aria-label', 'Afastar');
    zoomBtns.append(mais, menos);
    opts.root.append(zoomBtns);
    const zoomCentro = (f: number) => {
      const W = camada.clientWidth;
      const H = camada.clientHeight;
      const wx = (camada.scrollLeft + W / 2 - offX()) / escala;
      const wy = (camada.scrollTop + H / 2) / escala;
      const alvo = Math.max(escalaVisao(), Math.min(3, escala * f));
      detalhe = alvo > escalaVisao() * 1.4;
      zoomPara(alvo, wx, wy, W / 2, H / 2, 260);
    };
    mais.addEventListener('click', () => zoomCentro(1.6));
    menos.addEventListener('click', () => zoomCentro(1 / 1.6));
    let lembrada = 'salas';
    try {
      lembrada = localStorage.getItem(CHAVE_B) ?? 'salas';
    } catch {
      /* sem localStorage */
    }
    if (q.get('vista')) lembrada = q.get('vista')!;
    const aplica = (v: string) => {
      const ehPredio = v === 'predio';
      bS.setAttribute('aria-pressed', String(!ehPredio));
      bP.setAttribute('aria-pressed', String(ehPredio));
      camada.hidden = !ehPredio;
      zoomBtns!.hidden = !ehPredio;
      if (ehPredio) desenhar(performance.now());
      try {
        localStorage.setItem(CHAVE_B, v);
      } catch {
        /* sem localStorage */
      }
    };
    bS.addEventListener('click', () => aplica('salas'));
    bP.addEventListener('click', () => aplica('predio'));
    camada.classList.add('pv-camada--b');
    aplicarEscala(escalaVisao());
    aplica(lembrada);
  }

  posicionar();
  addEventListener('resize', () => {
    posicionar();
    aplicarEscala(detalhe ? escala : escalaVisao());
    desenhar(performance.now());
  });
  new ResizeObserver(() => posicionar()).observe(opts.topbar);
  requestAnimationFrame(loop);
}

function injetarCss(): void {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.append(st);
}

const CSS = `
html.pv-on #ui { top: 44px; transform: translateZ(0); }
html.pv-on #world { top: 44px; height: calc(100vh - 44px); }
.pv-faixa { position: fixed; inset: 0 0 auto 0; height: 44px; z-index: 9999; display: flex; align-items: center; gap: 6px;
  padding: 0 10px; background: #2a1f05; border-bottom: 1px solid #ffb547; font: 600 13px/1 system-ui, sans-serif; color: #ffe2a8; }
.pv-faixa__tit { margin-right: auto; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; }
.pv-faixa__op { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 12px; color: #ffe2a8; text-decoration: none; border-radius: 8px; }
.pv-faixa__op.is-on { background: #ffb547; color: #1b1405; }
.pv-faixa__op:focus-visible, .pv-btn:focus-visible, .pv-andar:focus-visible, .pv-alterna__op:focus-visible { outline: 2px solid #7cc8ff; outline-offset: 2px; }

.pv-camada { position: fixed; left: 0; right: 0; bottom: 0; top: 64px; z-index: 40; overflow: auto; background: #76a35c;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; font-family: var(--font-ui); cursor: grab; }
.pv-camada[hidden] { display: none; }
.pv-palco { position: relative; }
.pv-tela { position: sticky; top: 0; left: 0; display: block; image-rendering: pixelated; pointer-events: none; }
.pv-rotulos { position: absolute; inset: 0; pointer-events: none; }
.pv-rotulos > * { pointer-events: auto; }

.pv-rot { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none;
  will-change: transform; }
.pv-rot__nome { display: inline-flex; align-items: center; gap: 4px; padding: 1px 5px; border-radius: 4px; background: rgba(15,18,27,.86);
  color: #f3f5fa; font: 700 12px/16px var(--font-ui); white-space: nowrap; }
.pv-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.pv-selo { display: inline-flex; align-items: center; height: 15px; padding: 0 4px; border-radius: 3px; background: color-mix(in srgb, var(--c) 30%, #12151d);
  box-shadow: inset 0 0 0 1px var(--c); color: #f3f5fa; font: 700 11px/1 var(--font-ui); letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; }
.pv-selo--reserva { background: #ff9f1c; color: #1b1405; box-shadow: none; }
.pv-selo--portao { background: #ffb547; color: #1b1405; box-shadow: none; }
.pv-rot__est { display: none; padding: 1px 5px; border-radius: 4px; background: rgba(15,18,27,.86); color: #dfe4ee; font: 600 12px/15px var(--font-ui); white-space: nowrap; }
.pv-camada--detalhe .pv-rot__est { display: inline-block; }
.pv-rot--blocked .pv-rot__est { color: #ffd27a; }
.pv-rot--guarded .pv-rot__est { color: #ffb0b0; }

.pv-sala { position: absolute; left: 0; top: 0; padding: 0 4px; border-radius: 3px; background: rgba(15,18,27,.78); color: #e8ecf5;
  font: 700 11px/15px var(--font-ui); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; pointer-events: none; }

.pv-andar { position: absolute; left: 0; top: 0; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 8px; min-height: 44px;
  padding: 0 12px; border-radius: 8px; border: 1px solid #ffb547; background: #1b1405; color: #ffe2a8; font: 700 13px/1.15 var(--font-ui);
  letter-spacing: .04em; text-transform: uppercase; cursor: pointer; box-shadow: 0 2px 0 rgba(0,0,0,.35); max-width: calc(100vw - 16px); white-space: nowrap; }
.pv-andar__n { font-weight: 600; font-size: 12px; letter-spacing: 0; text-transform: none; color: #f2e3c2; white-space: nowrap; }
.pv-andar__n--mao { color: #1b1405; background: #ffb547; padding: 2px 6px; border-radius: 4px; }
.pv-camada--b .pv-andar { cursor: default; }

.pv-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 8px;
  background: #1d2333; color: #eef1f7; border: 1px solid #5d6680; font: 600 14px/1 var(--font-ui); cursor: pointer; }
.pv-btn:disabled { opacity: .45; cursor: default; }
.pv-btn--ic { padding: 0; font-size: 18px; }
.pv-nav { position: fixed; left: 0; right: 0; z-index: 46; display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  background: #0f121b; border-bottom: 1px solid #48526b; }
.pv-camada--nav .pv-andar { display: none; }
.pv-nav[hidden] { display: none; }
.pv-nav__tit { flex: 1; min-width: 0; color: #ffe2a8; font: 700 14px/1.2 var(--font-ui); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-camada--nav { padding-top: 0; }
.pv-mapa { position: absolute; }
.pv-flutua { position: fixed; left: 10px; z-index: 45; }
.pv-flutua[hidden] { display: none; }

.pv-alterna { position: fixed; left: 50%; transform: translateX(-50%); z-index: 45; display: flex; padding: 3px; background: #12151d; border: 1px solid #48526b; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.pv-alterna__op { min-height: 44px; min-width: 88px; padding: 0 14px; border-radius: 8px; color: #e8ecf5; font: 600 14px/1 var(--font-ui); background: none; border: 0; cursor: pointer; }
.pv-alterna__op[aria-pressed='true'] { background: #7cc8ff; color: #0b1320; }
.pv-zoom { position: fixed; right: 12px; z-index: 45; display: flex; flex-direction: column; gap: 6px; }
.pv-zoom[hidden] { display: none; }
`;

/** Parâmetros do protótipo: padrão do HTML estático (window.__PROTO_QS) + ?query + #hash (o hash vence). */
export function protoParams(): URLSearchParams {
  if (typeof location === 'undefined') return new URLSearchParams();
  const base = (globalThis as { __PROTO_QS?: string }).__PROTO_QS ?? '';
  const q = new URLSearchParams(base);
  for (const fonte of [location.search, location.hash.slice(1)]) for (const [k, v] of new URLSearchParams(fonte)) q.set(k, v);
  return q;
}

export const PROTOTIPO_ATIVO = protoParams().get('prototipo') === 'predio-vertical';
