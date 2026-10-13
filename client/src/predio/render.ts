// Desenho da vista Prédio no canvas (specs/predio-vertical.md, D1 e S6): o mesmo mapinha das salas (pisos, paredes,
// móveis, telas, janelas, árvores, carros), com os andares empilhados e a coluna do elevador à direita (hall, poço,
// escada e a cabine). Copiado e organizado do protótipo (branch prototipo/predio-vertical, `desenhar`).
// Só desenha o que está visível; quem chama decide o ritmo (12 quadros/s, D9).
import { TILE, type ArtModule, type Dir, type Pose, type ScreenMode, type Sprite } from '../art/api';
import { EXTERIOR_WALL } from '../world/layout/exterior';
import type { ExteriorProp } from '../world/layout/types';
import { carSprite, propSprite, shadowSprite } from '../world/render/props';
import { buildAreaVis, furnitureSprites, opaqueBounds, WALL_MARGIN, wallItemOrigin, wallSprites, type AreaVis, type FurnVis } from '../world/render/scene';
import type { Boneco, Caixa } from './bonecos';
import { BW, BX, ESCADA_W, ESCADA_X, HALL_W, LAJE, POCO_W, POCO_X, WT, type Cena } from './planta';

/**
 * Sprites do elevador e da escada (S5, aditivos e opcionais no ArtModule). Enquanto a S5 não está na main, o
 * desenho usa os pisos do kit no lugar deles.
 * TODO(S5, escritorio t_bc0f8c08): com `elevatorCab`/`drawShaft`/`drawStairs` no `ArtModule`, apagar este tipo e
 * os desenhos provisórios de `desenharColuna`.
 */
export type ArtPredio = ArtModule & {
  elevatorCab?(door: number): Sprite;
  drawShaft?(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  drawStairs?(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void;
};

export interface Visao {
  /** Escala de mundo → tela (px CSS). */
  escala: number;
  /** Deslocamento horizontal do mundo dentro do palco (px CSS; o prédio fica no meio quando sobra largura). */
  ox: number;
  scrollLeft: number;
  scrollTop: number;
  /** Tamanho visível da camada (px CSS). */
  W: number;
  H: number;
  dpr: number;
}

export interface Quadro {
  cena: Cena;
  vis: AreaVis[];
  bonecos: readonly Boneco[];
  porMesa: ReadonlyMap<string, Boneco>;
  deployRodando: boolean;
  /** Cabine (S8): andar fracionário, porta 0..4 e quem está dentro (ids de boneco ou `caixa:<chave>`). */
  elevador: { readonly posicao: number; readonly porta: number; readonly carga: readonly string[] };
  /** 📦 fora das mãos (na porta, na cabine ou sobre a mesa). */
  caixas: readonly Caixa[];
}

/** Topo da cabine (px de mundo) no andar fracionário `posicao` (0 = Cobertura): entre as paradas dos dois andares. */
export function cabineY(cena: Cena, posicao: number): number {
  const n = cena.andares.length;
  const p = Math.max(0, Math.min(n - 1, posicao));
  const i0 = Math.floor(p);
  const i1 = Math.min(n - 1, i0 + 1);
  const y = (i: number) => (cena.paradas[cena.andares[i]!.id].cy + 1) * TILE;
  return y(i0) + (y(i1) - y(i0)) * (p - i0);
}

/** Sprite do boneco no quadro (pose animada); null se o kit não desenha a combinação. */
function spriteBoneco(art: ArtModule, b: Boneco, agora: number, pose: Pose = b.pose, dir: Dir = b.dir): Sprite | null {
  const n = art.poseFrameCount(pose);
  const frame = Math.floor(agora / art.poseFrameDuration(pose) + (b.seed % 7)) % n;
  try {
    return art.characterSprite({ appearance: b.ap, dir, pose, frame, held: b.held, seated: false });
  } catch {
    return null;
  }
}

/** Visual das áreas (pisos, paredes e móveis pré-desenhados); uma vez por cena. */
export function areasVis(art: ArtModule, cena: Cena): AreaVis[] {
  return cena.areas.map((a) => buildAreaVis(art, a, undefined, null));
}

interface Ent {
  y: number;
  k: 0 | 1 | 2 | 3;
  f?: FurnVis;
  b?: Boneco;
  p?: ExteriorProp;
}

function telaDaMesa(f: FurnVis, porMesa: ReadonlyMap<string, Boneco>): ScreenMode {
  const b = f.seatSpot ? porMesa.get(f.seatSpot) : undefined;
  if (!b) return 'standby';
  if (b.modo !== 'mesa') return 'idle';
  if (b.o.estado === 'blocked' || b.o.estado === 'guarded') return 'alert';
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

/** Poço e escada (contínuos do topo do prédio ao fim do Térreo) e a cabine na posição fracionária (S8). */
function desenharColuna(ctx: CanvasRenderingContext2D, art: ArtPredio, q: Quadro, agora: number): void {
  const { cena } = q;
  const y0 = cena.predioY0 * TILE;
  const h = (cena.predioY1 - cena.predioY0) * TILE;
  const px = POCO_X * TILE;
  const pw = POCO_W * TILE;
  const ex = ESCADA_X * TILE;
  const ew = ESCADA_W * TILE;
  if (art.drawShaft) art.drawShaft(ctx, px, y0, pw, h);
  else {
    // provisório até a S5: vão escuro sobre o cimento, com os dois trilhos-guia
    art.drawFloor(ctx, 'concrete', px, y0, pw, h, { seed: 5 });
    ctx.fillStyle = 'rgba(15,18,27,0.72)';
    ctx.fillRect(px, y0, pw, h);
    ctx.fillStyle = 'rgba(160,176,210,0.35)';
    ctx.fillRect(px + 3, y0, 2, h);
    ctx.fillRect(px + pw - 5, y0, 2, h);
  }
  if (art.drawStairs) art.drawStairs(ctx, ex, y0, ew, h, 7);
  else {
    // provisório até a S5: degraus vistos de cima
    art.drawFloor(ctx, 'concrete', ex, y0, ew, h, { seed: 9 });
    ctx.fillStyle = 'rgba(15,18,27,0.28)';
    for (let y = y0 + 3; y < y0 + h; y += 5) ctx.fillRect(ex, y, ew, 1);
    ctx.fillRect(ex + ew - 2, y0, 2, h);
  }
  const cx = px;
  const cy = Math.round(cabineY(cena, q.elevador.posicao));
  const cab = art.elevatorCab?.(q.elevador.porta);
  if (cab) ctx.drawImage(cab.canvas, Math.round(cx + pw / 2 - cab.ax), Math.round(cy + 2 * TILE - cab.ay));
  else {
    // provisório até a S5: piso da cabine e a porta fechada a oeste
    art.drawFloor(ctx, 'concrete', cx + 1, cy + 1, pw - 2, 2 * TILE - 2, { seed: 13 });
    ctx.fillStyle = 'rgba(15,18,27,0.6)';
    ctx.fillRect(cx, cy, pw, 1);
    ctx.fillRect(cx, cy + 2 * TILE - 1, pw, 1);
    ctx.fillRect(cx + pw - 1, cy, 1, 2 * TILE);
    ctx.fillStyle = '#8b93a5';
    ctx.fillRect(cx, cy + 2, 2, 2 * TILE - 4);
  }
  // passageiros recortados dentro da cabine (sem crachá) e o 📦 sobre a cabine se alguém leva caixa
  let caixa = false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx + 3, cy + 3, pw - 6, 2 * TILE - 6);
  ctx.clip();
  q.elevador.carga.forEach((id, i) => {
    if (id.startsWith('caixa:')) return void (caixa = true);
    const b = q.bonecos.find((x) => x.id === id);
    if (!b) return;
    if (b.held === 'box') caixa = true;
    const sp = spriteBoneco(art, b, agora, 'stand', 'left');
    if (sp) ctx.drawImage(sp.canvas, Math.round(cx + 13 + i * 11 - sp.ax), Math.round(cy + 2 * TILE - 3 - sp.ay));
  });
  ctx.restore();
  if (caixa) {
    const ic = art.iconSprite('box');
    const pula = Math.round(Math.sin(agora / 260) * 1.5);
    ctx.drawImage(ic.canvas, Math.round(cx + pw / 2 - ic.canvas.width / 2), cy - ic.canvas.height - 1 + pula);
  }
}

/** Desenha um quadro. Atualiza `b.head` de cada boneco visível (px de mundo), para os crachás. */
export function desenhar(ctx: CanvasRenderingContext2D, art: ArtPredio, q: Quadro, v: Visao, agora: number): void {
  const { cena } = q;
  const WPX = WT * TILE;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#76a35c';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const s = v.escala * v.dpr;
  ctx.setTransform(s, 0, 0, s, (v.ox - v.scrollLeft) * v.dpr, -v.scrollTop * v.dpr);
  const vx0 = (v.scrollLeft - v.ox) / v.escala;
  const vy0 = v.scrollTop / v.escala;
  const vx1 = vx0 + v.W / v.escala;
  const vy1 = vy0 + v.H / v.escala;
  const vis = (x: number, y: number, w: number, h: number) => x < vx1 && x + w > vx0 && y < vy1 && y + h > vy0;
  // gramado (o mesmo piso do mapa) cobrindo o que se vê
  const gx0 = Math.floor(vx0 / TILE) * TILE - TILE;
  const gy0 = Math.max(0, Math.floor(vy0 / TILE) * TILE - TILE);
  const gw = Math.ceil((vx1 - gx0) / TILE + 2) * TILE;
  art.drawFloor(ctx, 'grass', gx0, gy0, gw, Math.ceil((vy1 - gy0) / TILE + 2) * TILE, { seed: 11 });
  // calçada e rua
  const ry = cena.ruaY;
  art.drawFloor(ctx, 'sidewalk', gx0, ry, gw, 2 * TILE, { seed: 3 });
  art.drawFloor(ctx, 'street', gx0, ry + 2 * TILE, gw, 4 * TILE, { seed: 3 });
  ctx.fillStyle = 'rgba(255,236,170,0.75)';
  for (let x = Math.floor(gx0 / 24) * 24; x < vx1; x += 24) ctx.fillRect(x, ry + 4 * TILE - 1, 12, 2);
  // lajes entre os andares (tijolo da fachada), do prédio até o hall
  const lw = (BW + HALL_W) * TILE + 4;
  for (const a of cena.andares) {
    const y = a.y0 * TILE;
    if (!vis(BX * TILE - 8, y, lw + 8, LAJE * TILE)) continue;
    art.drawWallTop(ctx, BX * TILE - 4, y, lw, LAJE * TILE, EXTERIOR_WALL);
    ctx.fillStyle = 'rgba(30,34,48,0.35)';
    ctx.fillRect(BX * TILE - 4, y + LAJE * TILE - 2, lw, 2);
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
  const areaVisivel = (a: AreaVis) => vis(a.px.x, a.px.y - WALL_MARGIN, a.px.w, a.px.h + WALL_MARGIN);
  for (const a of q.vis) if (areaVisivel(a)) ctx.drawImage(a.floor, a.px.x, a.px.y);
  for (const a of q.vis) {
    if (!areaVisivel(a)) continue;
    ctx.drawImage(a.walls, a.px.x, a.px.y - WALL_MARGIN);
    for (const w of a.wallItems) {
      const sp = wallSprites(art, w.kind, w.variant, 0, w.seed);
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
  // coluna do elevador (poço, escada e cabine)
  if (vis(POCO_X * TILE, cena.predioY0 * TILE, (POCO_W + ESCADA_W) * TILE, (cena.predioY1 - cena.predioY0) * TILE)) desenharColuna(ctx, art, q, agora);
  // entidades por profundidade
  const ents: Ent[] = [];
  for (const a of q.vis) {
    if (!vis(a.px.x - TILE, a.px.y - 3 * TILE, a.px.w + 2 * TILE, a.px.h + 4 * TILE)) continue;
    for (const f of a.furniture) {
      ents.push({ y: f.ay, k: 0, f });
      if (furnitureSprites(art, f, 0)?.front) ents.push({ y: f.ay + 0.5, k: 1, f });
    }
  }
  for (const b of q.bonecos) {
    // dentro da cabine: desenhado recortado pela coluna, sem crachá (D4)
    if (b.dentro || !vis(b.x - 24, b.y - 48, 48, 60)) {
      b.head.ok = false;
      continue;
    }
    const parado = b.modo === 'mesa' || b.pi >= b.path.length;
    const sortY = b.seated && parado ? (b.modo === 'mesa' ? b.mesa?.sortY : b.alvo?.sortY) ?? b.y : b.y;
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
        art.drawScreen(ctx, { x: dx + r.x, y: dy + r.y, w: r.w, h: r.h }, telaDaMesa(f, q.porMesa), agora, f.seed);
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
      const sy = y - sp.ay;
      ctx.drawImage(sp.canvas, x - sp.ax, sy);
      b.head = { x, y: sy + opaqueBounds(sp.canvas).y, ok: true };
    } else {
      const p = e.p!;
      const s2 = propSprite(p);
      ctx.drawImage(s2.canvas, Math.round(p.x - s2.ax), Math.round(p.y - s2.ay));
    }
  }
  // 📦 fora das mãos: na porta do elevador esperando a cabine ou quem busca, ou sobre a mesa livre
  for (const c of q.caixas) {
    if (c.dentro || !vis(c.x - 12, c.y - 24, 24, 24)) continue;
    const ic = art.iconSprite('box');
    ctx.drawImage(ic.canvas, Math.round(c.x - ic.canvas.width / 2), Math.round(c.y - ic.canvas.height));
  }
  // ícones sobre a cabeça
  for (const b of q.bonecos) {
    if (!b.head.ok || !b.icone || (b.pose === 'walk' && b.icone === 'coffee')) continue;
    const ic = art.iconSprite(b.icone);
    const pula = Math.round(Math.sin(agora / 260 + b.seed) * 1.5);
    ctx.drawImage(ic.canvas, Math.round(b.head.x + 5), Math.round(b.head.y - ic.canvas.height - 1 + pula));
  }
  // rua: carros e o caminhão do deployer saindo
  {
    const u = (agora % 11000) / 11000;
    const car = carSprite(2, false);
    const cx = WPX + 40 - u * (WPX + 120);
    ctx.drawImage(car.canvas, Math.round(cx - car.ax), Math.round(ry + 3 * TILE - car.ay));
    const car2 = carSprite(4, true);
    const cx2 = -60 + ((u + 0.45) % 1) * (WPX + 120);
    ctx.drawImage(car2.canvas, Math.round(cx2 - car2.ax), Math.round(ry + 5 * TILE + 4 - car2.ay));
    if (q.deployRodando) {
      const v2 = (agora % 9000) / 9000;
      // sai da garagem do térreo e segue para a esquerda
      desenharCaminhao(ctx, Math.round((BX + 24) * TILE - v2 * (WPX + 80)), Math.round(ry + 2 * TILE + 5), agora);
    }
  }
  // portão da garagem do deployer na calçada
  ctx.fillStyle = '#3a4258';
  ctx.fillRect((BX + 22) * TILE, ry - 4, 4 * TILE, 4);
}
