// Posição dos crachás da vista Prédio (specs/predio-vertical.md, D4; fatia S7): nunca em cima de móvel, de placa ou
// de outro crachá, e nunca cortados na borda. Puro, tudo em px de tela.
import type { Ret } from './enquadrar';

export interface ItemCracha {
  id: string;
  /** Topo da cabeça (centro) e os pés (o ponto do chão), em px de tela. */
  cabeca: { x: number; y: number };
  pes: { x: number; y: number };
  w: number;
  h: number;
  sentado: boolean;
}

export interface PosCracha {
  id: string;
  x: number;
  y: number;
  /** Área (px²) que ainda cobre de obstáculo; 0 = livre. */
  sobreposicao: number;
}

/** Folga entre o crachá e a cabeça/os pés. */
const FOLGA = 4;
const PASSO = 4;
const DESLOC_MAX = 48;
/** Cobrir outro crachá ou placa vale por 50 vezes a mesma área de móvel (só conta quando não há lugar livre). */
const PESO_DURO = 50;
/** Depois das posições de D4: deslocamentos (a partir de "acima da cabeça") até 96 px, do mais perto ao mais longe. */
export const BUSCA_MAX = 96;
const ANEL: { x: number; y: number }[] = [];
for (let dy = -BUSCA_MAX; dy <= BUSCA_MAX; dy += PASSO) for (let dx = -BUSCA_MAX; dx <= BUSCA_MAX; dx += PASSO) ANEL.push({ x: dx, y: dy });
ANEL.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));

export function sobrepoe(a: Ret, b: Ret): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Posições a tentar, na ordem de D4: acima, abaixo, esquerda, direita e as duas primeiras deslocadas até 48 px. */
function candidatos(it: ItemCracha, busca: number): { x: number; y: number }[] {
  const acima = { x: it.cabeca.x - it.w / 2, y: it.cabeca.y - it.h - FOLGA };
  const abaixo = { x: it.pes.x - it.w / 2, y: it.pes.y + FOLGA };
  const meioY = it.cabeca.y - it.h / 2;
  const c = [acima, abaixo, { x: it.cabeca.x - it.w - FOLGA * 2, y: meioY }, { x: it.cabeca.x + FOLGA * 2, y: meioY }];
  for (let d = PASSO; d <= DESLOC_MAX; d += PASSO)
    c.push(
      { x: acima.x, y: acima.y - d },
      { x: abaixo.x, y: abaixo.y + d },
      { x: acima.x - d, y: acima.y },
      { x: acima.x + d, y: acima.y },
      { x: abaixo.x - d, y: abaixo.y },
      { x: abaixo.x + d, y: abaixo.y },
    );
  // sala cheia (mesas, cadeiras, estantes): o chão livre mais perto da cabeça, até `busca` px (no máximo BUSCA_MAX)
  for (const p of ANEL) if (Math.abs(p.x) <= busca && Math.abs(p.y) <= busca) c.push({ x: acima.x + p.x, y: acima.y + p.y });
  return c;
}

/**
 * Põe cada crachá na primeira posição livre (sentados primeiro, depois quem anda, de cima para baixo). O crachá
 * posto vira obstáculo dos próximos. Sem posição livre: a de menor sobreposição, e cobrir crachá ou um dos `duros`
 * (placa de andar, nome de sala, botões fixos) pesa muito mais que cobrir móvel. `x` e `y` sempre presos ao `limite`.
 */
export function posicionarCrachas(itens: readonly ItemCracha[], obstaculos: readonly Ret[], limite: Ret, duros: readonly Ret[] = [], busca = BUSCA_MAX): PosCracha[] {
  const ordem = [...itens].sort((a, b) => Number(b.sentado) - Number(a.sentado) || a.cabeca.y - b.cabeca.y);
  const postos: Ret[] = [];
  const saida: PosCracha[] = [];
  const prender = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  for (const it of ordem) {
    let melhor: { x: number; y: number; s: number; area: number } | null = null;
    for (const c of candidatos(it, busca)) {
      // px inteiros (o crachá é posto com translate em px inteiros), sempre dentro do limite
      const x = prender(Math.round(c.x), Math.ceil(limite.x), Math.floor(limite.x + limite.w - it.w));
      const y = prender(Math.round(c.y), Math.ceil(limite.y), Math.floor(limite.y + limite.h - it.h));
      // fora do limite na vertical, o crachá sairia do lugar dele: só serve se nada mais servir
      const fora = Math.abs(y - c.y) > 0.5 ? it.w * it.h : 0;
      const r = { x, y, w: it.w, h: it.h };
      let mole = 0;
      let duro = 0;
      for (const o of obstaculos) mole += sobrepoe(r, o);
      for (const o of duros) duro += sobrepoe(r, o);
      for (const o of postos) duro += sobrepoe(r, o);
      const s = fora + mole + PESO_DURO * duro;
      if (!melhor || s < melhor.s) melhor = { x, y, s, area: mole + duro };
      if (s === 0) break;
    }
    const m = melhor!;
    postos.push({ x: m.x, y: m.y, w: it.w, h: it.h });
    saida.push({ id: it.id, x: m.x, y: m.y, sobreposicao: m.area });
  }
  return saida;
}
