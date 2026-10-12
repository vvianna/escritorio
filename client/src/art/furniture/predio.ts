// Coluna do elevador da vista Prédio (spec predio-vertical, S5), vista de cima como o mapa das salas:
// a cabine (sprite 3 × 2 tiles, porta no lado oeste), o poço (vão escuro com trilhos) e a escada
// (degraus vistos de cima, corrimão dos dois lados; só cenário).
//
// Cores: as do tema cinza (roomTheme 6) e o piso quente do tema 9, de ./theme, e o mesmo metal da
// porta `elevator` de ./wall (moldura #aeb6c2, folhas #c9d0d9). Nada de cor nova.
// drawShaft/drawStairs só usam fillRect (como ./dynamic) e são contínuos entre chamadas: trilhos,
// suportes e degraus se alinham à grade do mundo, então o poço pode ser desenhado andar por andar.
import { TILE } from '../api';
import { ramp, shade } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';
import { roomTheme } from '../theme';
import { rngOf } from './kit';

const CINZA = roomTheme(6); // carpete #aab1bd/#9fa7b4, parede #e8eaee, friso #6d7583, destaque #f2c14e
const QUENTE = roomTheme(9); // carpete #d1c5b8/#c5b8aa

/** Mesmo metal da porta `elevator` (./wall.ts). */
const FRAME = ramp('#aeb6c2', 0.06);
const DOOR = ramp('#c9d0d9', 0.05);

/** Paleta do poço e da escada (exportada para o teste conferir que nada sai dela). */
export const PREDIO_PAL = {
  shaft: shade(CINZA.wall.trim!, -0.3),
  shaftEdge: shade(CINZA.wall.trim!, -0.38),
  cable: shade(CINZA.wall.trim!, -0.16),
  bracket: CINZA.wall.trim!,
  rail: CINZA.carpet2,
  railHi: CINZA.carpet,
  tread: CINZA.wall.base,
  treadScuff: shade(CINZA.wall.base, -0.05),
  nose: CINZA.carpet,
  riser: CINZA.carpet2,
  handrail: CINZA.wall.trim!,
  handrailHi: CINZA.carpet,
} as const;

/** Cabine: 3 × 2 tiles. */
export const CAB_W = 3 * TILE;
export const CAB_H = 2 * TILE;

/**
 * Cabine vista de cima, 48 × 32 px totalmente opacos. `door` 0 = fechada … 4 = aberta; as duas folhas
 * da porta (lado oeste) correm para norte e sul, 3 px por estado. Âncora: centro da borda de baixo.
 */
export function renderElevatorCab(door: number): BufSprite {
  const st = Math.max(0, Math.min(4, Math.round(door)));
  const b = new PixelBuf(CAB_W, CAB_H);
  const lit = st > 0;
  // Paredes (topo do metal) e aresta externa.
  b.rect(0, 0, CAB_W, CAB_H, FRAME.base);
  b.hline(0, CAB_W - 1, 0, FRAME.hi);
  b.vline(0, 0, CAB_H - 1, FRAME.dk);
  b.hline(0, CAB_W - 1, CAB_H - 1, FRAME.dd);
  b.vline(CAB_W - 1, 0, CAB_H - 1, FRAME.dd);
  b.hline(1, CAB_W - 2, 1, FRAME.lt);
  // Piso da cabine: placas quentes de 8 × 8 com rejunte fino.
  const fx = 3;
  const fy = 3;
  const fw = CAB_W - 6;
  const fh = CAB_H - 6;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const grout = (x + 3) % 8 === 0 || (y + 5) % 8 === 0;
      b.set(fx + x, fy + y, grout ? QUENTE.carpet2 : QUENTE.carpet);
    }
  }
  // Sombra das paredes norte e leste no piso.
  b.hline(fx, fx + fw - 1, fy, shade(QUENTE.carpet2, -0.06));
  b.vline(fx + fw - 1, fy, fy + fh - 1, shade(QUENTE.carpet2, -0.06));
  // Corrimão nas paredes norte, leste e sul.
  b.hline(fx + 6, fx + fw - 2, fy + 1, DOOR.hi);
  b.hline(fx + 6, fx + fw - 2, fy + 2, DOOR.dk);
  b.vline(fx + fw - 3, fy + 1, fy + fh - 2, DOOR.hi);
  b.vline(fx + fw - 2, fy + 1, fy + fh - 2, DOOR.dk);
  b.hline(fx + 6, fx + fw - 2, fy + fh - 2, DOOR.hi);
  b.hline(fx + 6, fx + fw - 2, fy + fh - 1, DOOR.dk);
  // Botoeira na parede norte, junto da porta; acende enquanto a porta está aberta.
  b.rect(5, 1, 4, 1, CINZA.wall.trim);
  b.set(6, 1, lit ? CINZA.accent : CINZA.carpet2);
  // Porta no lado oeste: vão de 24 px (y 4..27), soleira no chão e duas folhas de 12 px.
  const dy = 4;
  const dh = 24;
  const leaf = dh / 2;
  const open = st * 3;
  b.rect(0, dy, 3, dh, QUENTE.carpet2);
  b.vline(0, dy, dy + dh - 1, FRAME.dd);
  b.vline(1, dy, dy + dh - 1, FRAME.dk);
  const drawLeaf = (y0: number, h: number) => {
    if (h <= 0) return;
    b.rect(0, y0, 3, h, DOOR.base);
    b.vline(0, y0, y0 + h - 1, DOOR.lt);
    b.vline(2, y0, y0 + h - 1, DOOR.dk);
  };
  drawLeaf(dy, leaf - open);
  drawLeaf(dy + leaf + open, leaf - open);
  if (st === 0) b.hline(0, 2, dy + leaf, DOOR.dd);
  // Batentes da porta.
  b.hline(0, 2, dy - 1, FRAME.dd);
  b.hline(0, 2, dy + dh, FRAME.dd);
  return { buf: b, ax: CAB_W / 2, ay: CAB_H };
}

type Ctx = CanvasRenderingContext2D;

/** fillRect recortado ao retângulo [cx, cx + cw) × [cy, cy + ch). */
function clipFill(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, cx: number, cy: number, cw: number, ch: number): void {
  const x0 = Math.max(x, cx);
  const y0 = Math.max(y, cy);
  const x1 = Math.min(x + w, cx + cw);
  const y1 = Math.min(y + h, cy + ch);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Poço do elevador: vão escuro com dois trilhos-guia, suportes a cada tile e os cabos no meio. */
export function drawShaft(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const P = PREDIO_PAL;
  const f = (c: string, rx: number, ry: number, rw: number, rh: number) => clipFill(ctx, c, rx, ry, rw, rh, x, y, w, h);
  f(P.shaft, x, y, w, h);
  f(P.shaftEdge, x, y, 1, h);
  f(P.shaftEdge, x + w - 1, y, 1, h);
  if (w < 12) return;
  // Cabos de tração no centro.
  const cx = x + Math.floor(w / 2);
  f(P.cable, cx - 2, y, 1, h);
  f(P.cable, cx + 1, y, 1, h);
  // Trilhos-guia junto das paredes, presos por suportes alinhados à grade do mundo.
  const left = x + 3;
  const right = x + w - 5;
  for (let ty = Math.floor(y / TILE) * TILE + TILE / 2; ty < y + h; ty += TILE) {
    f(P.bracket, x + 1, ty, 3, 2);
    f(P.bracket, right + 1, ty, 3, 2);
  }
  for (const rx of [left, right]) {
    f(P.rail, rx, y, 2, h);
    f(P.railHi, rx, y, 1, h);
  }
}

/** Passo dos degraus (px): 4 de piso + 1 de espelho. */
const STEP = 5;

/** Escada vista de cima: degraus de norte a sul e corrimão dos dois lados. Só cenário. */
export function drawStairs(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const P = PREDIO_PAL;
  const f = (c: string, rx: number, ry: number, rw: number, rh: number) => clipFill(ctx, c, rx, ry, rw, rh, x, y, w, h);
  const rail = w >= 10 ? 2 : 0;
  const sx = x + rail;
  const sw = w - rail * 2;
  f(P.tread, sx, y, sw, h);
  // Degraus alinhados à grade do mundo (continuam iguais entre chamadas vizinhas).
  for (let k = Math.floor(y / STEP); k * STEP < y + h; k++) {
    const ry = k * STEP;
    f(P.nose, sx, ry, sw, 1);
    f(P.riser, sx, ry + STEP - 1, sw, 1);
    // Marcas de uso, fixas por degrau e semente.
    const r = rngOf(seed, k);
    if (sw > 6 && r() < 0.25) f(P.treadScuff, sx + 2 + Math.floor(r() * (sw - 5)), ry + 2, 2, 1);
  }
  if (!rail) return;
  // Corrimão: barra escura com brilho e pinos a cada meio tile.
  for (const rx of [x, x + w - 2]) {
    f(P.handrail, rx, y, 2, h);
    f(P.handrailHi, rx === x ? rx + 1 : rx, y, 1, h);
  }
  for (let py = Math.floor(y / (TILE / 2)) * (TILE / 2); py < y + h; py += TILE / 2) {
    f(P.handrailHi, x, py, 2, 1);
    f(P.handrailHi, x + w - 2, py, 2, 1);
  }
}
