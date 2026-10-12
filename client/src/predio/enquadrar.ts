// Escalas e rolagem da vista Prédio (specs/predio-vertical.md, D3; fatia S7). Puro: tudo em px (mundo ou tela),
// sem DOM. Quem chama (vista.ts) mede a camada e a área livre (--free-left/--free-right) e aplica o resultado.
import { TILE } from '../art/api';
import { BW, BX, LAJE, WT, type AndarCena, type Cena } from './planta';

export const ESCALA_MAX = 3;
/** Folga mínima entre o retângulo enquadrado e a borda da área livre (px de tela). */
export const MARGEM = 8;
/** O topo do que se enquadra fica 60 px abaixo do topo da camada (o alternador ocupa 8..52 px). */
export const TOPO_PX = 60;
/** Largura de tela a partir da qual tocar no andar enquadra o andar inteiro (abaixo: só a sala tocada). */
export const LARGO_PX = 700;

export interface Ret {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margens laterais da área livre (lista lateral à esquerda, gaveta à direita), em px de tela. */
export interface Livre {
  l: number;
  r: number;
}

/** Faixas de cima e de baixo cobertas na camada (topo: o que passa da barra; baixo: barra/gaveta Atividade). */
export interface LivreV {
  t: number;
  b: number;
}

/** Parte do palco (px) que aparece de fato: a tela rolada menos lista, gaveta, faixa do topo e Atividade. */
export function areaVisivel(sl: number, st: number, W: number, H: number, livre: Livre, v: LivreV): Ret {
  return { x: sl + livre.l, y: st + v.t, w: W - livre.l - livre.r, h: H - v.t - v.b };
}

/**
 * Centro `y` da placa de um andar (px do palco): não sobe acima de `topoVis + MARGEM` (fica toda abaixo da barra
 * do topo), mas também não desce além do fim do próprio andar (`fimAndar`). Andar fora da tela: não mexe.
 */
export function prenderPlaca(y: number, h: number, topoVis: number, fimAndar: number): number {
  const min = topoVis + MARGEM + h / 2;
  if (y >= min || fimAndar <= topoVis) return y;
  return Math.max(y, Math.min(min, fimAndar - MARGEM - h / 2));
}

export interface Enquadramento {
  escala: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Visão geral: o prédio inteiro na largura livre, entre 0,5 e 1,5. */
export function escalaVisao(W: number, livre: Livre = { l: 0, r: 0 }): number {
  return Math.max(0.5, Math.min(1.5, (W - livre.l - livre.r) / (WT * TILE)));
}

/**
 * Enquadra `ret` (px de mundo) sem corte: escala = min(ESCALA_MAX, (largura livre − 2·margem) / ret.w), o retângulo
 * centrado na área livre (logo dentro de [l + margem, W − r − margem]) e o topo dele em TOPO_PX.
 * `ox(escala)` = deslocamento do mundo dentro do palco para aquela escala (o prédio centrado quando sobra largura).
 */
export function enquadrarRet(
  ret: Ret,
  W: number,
  _H: number,
  margem = MARGEM,
  livre: Livre = { l: 0, r: 0 },
  ox: (escala: number) => number = () => 0,
): Enquadramento {
  const larg = W - livre.l - livre.r;
  const escala = Math.min(ESCALA_MAX, (larg - 2 * margem) / ret.w);
  const sx = livre.l + (larg - ret.w * escala) / 2;
  return {
    escala,
    scrollLeft: Math.max(0, ox(escala) + ret.x * escala - sx),
    scrollTop: Math.max(0, ret.y * escala - TOPO_PX),
  };
}

/** Andar inteiro na largura: o prédio e a coluna do elevador (hall, poço e escada), `(BW + 7) × 16` px. */
export function retAndar(a: AndarCena): Ret {
  return { x: BX * TILE, y: (a.y0 + LAJE) * TILE, w: (BW + 7) * TILE, h: (a.y1 - a.y0 - LAJE) * TILE };
}

/** Sala (ou copa, terraço, recepção) do andar `a` no lado `direita`, a mais perto de `wy` (px de mundo). */
export function retSala(a: AndarCena, direita: boolean, wy?: number): Ret {
  const x = BX + (direita ? BW / 2 : 0);
  const pecas = a.areas.filter((ar) => ar.rect.x === x && ar.rect.w === BW / 2 && !ar.id.endsWith(':corredor'));
  const centro = (ar: (typeof pecas)[number]) => (ar.rect.y + ar.rect.h / 2) * TILE;
  const p = wy === undefined ? pecas[0] : pecas.reduce((m, ar) => (Math.abs(centro(ar) - wy) < Math.abs(centro(m) - wy) ? ar : m));
  if (!p) return retAndar(a);
  return { x: p.rect.x * TILE, y: p.rect.y * TILE, w: p.rect.w * TILE, h: p.rect.h * TILE };
}

/** Sala pelo id de PLANTA (`?sala=`), em px de mundo; null se não existe na cena. */
export function retSalaPorId(cena: Cena, id: string): Ret | null {
  const ar = cena.salaDe.get(id);
  return ar ? { x: ar.rect.x * TILE, y: ar.rect.y * TILE, w: ar.rect.w * TILE, h: ar.rect.h * TILE } : null;
}

/** Lado tocado: metade direita do prédio ou a coluna do elevador = direita. */
export function ladoDireito(wx: number): boolean {
  return wx >= (BX + BW / 2) * TILE;
}

/** Andar sob o ponto `wy` (px de mundo), da laje ao fim do andar. */
export function andarEm(cena: Cena, wy: number): AndarCena | undefined {
  return cena.andares.find((a) => wy >= a.y0 * TILE && wy < a.y1 * TILE);
}
