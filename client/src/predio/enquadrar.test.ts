import { describe, expect, it } from 'vitest';
import { roomTheme } from '../art/theme';
import { TILE } from '../art/api';
import { exemploPredio, montarPredio } from '../ui/predio-model';
import { andarEm, enquadrarRet, ESCALA_MAX, escalaVisao, ladoDireito, retAndar, retSala, retSalaPorId, TOPO_PX } from './enquadrar';
import { BX, montarCena } from './planta';

const cena = () => {
  const { agentes, uso } = exemploPredio(0);
  return montarCena(montarPredio(agentes, uso), { roomTheme });
};

/** Onde o retângulo cai na tela depois de aplicar o enquadramento. */
const naTela = (ret: { x: number; w: number }, e: { escala: number; scrollLeft: number }, ox = 0) => {
  const esquerda = ox + ret.x * e.escala - e.scrollLeft;
  return { esquerda, direita: esquerda + ret.w * e.escala };
};

describe('enquadrar (D3)', () => {
  it('visão geral: ≈ 0,57 em 375 e 1,5 em 1280', () => {
    expect(escalaVisao(375)).toBeCloseTo(375 / 656, 3);
    expect(escalaVisao(1280)).toBe(1.5);
    expect(escalaVisao(200)).toBe(0.5);
  });

  it('sala de 256 px em W = 375 → escala ≈ 1,40 e a sala inteira em [8, 367]', () => {
    const ret = { x: 17 * TILE, y: 200, w: 256, h: 192 };
    const e = enquadrarRet(ret, 375, 700);
    expect(e.escala).toBeCloseTo(1.4, 2);
    const t = naTela(ret, e);
    expect(t.esquerda).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(t.direita).toBeLessThanOrEqual(367 + 1e-9);
    expect(t.direita - t.esquerda).toBeCloseTo(359, 6);
    expect(e.scrollTop).toBeCloseTo(200 * e.escala - TOPO_PX, 6);
  });

  it('andar de 624 px em 1280 → escala ≈ 2,03, inteiro na tela', () => {
    const c = cena();
    const ti = c.andares.find((a) => a.id === 'ti')!;
    const ret = retAndar(ti);
    expect(ret.w).toBe(624);
    const e = enquadrarRet(ret, 1280, 800);
    expect(e.escala).toBeCloseTo(2.03, 2);
    const t = naTela(ret, e);
    expect(t.esquerda).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(t.direita).toBeLessThanOrEqual(1272 + 1e-9);
  });

  it('com a lista lateral aberta, centra na área livre (fora da lista e da gaveta)', () => {
    const ret = { x: 16, y: 0, w: 624, h: 100 };
    const livre = { l: 314, r: 0 };
    const ox = (s: number) => livre.l + 10 * s; // o palco desloca o prédio para a área livre
    const e = enquadrarRet(ret, 1280, 800, 8, livre, ox);
    expect(e.escala).toBeCloseTo((1280 - 314 - 16) / 624, 6);
    const t = naTela(ret, e, ox(e.escala));
    expect(t.esquerda).toBeCloseTo(314 + 8, 6);
    expect(t.direita).toBeCloseTo(1272, 6);
  });

  it('nunca passa de ESCALA_MAX', () => {
    expect(enquadrarRet({ x: 0, y: 0, w: 50, h: 50 }, 1280, 800).escala).toBe(ESCALA_MAX);
  });

  it('sala do lado tocado, a mais perto do toque; ?sala= pelo id de PLANTA', () => {
    const c = cena();
    const ti = c.andares.find((a) => a.id === 'ti')!;
    const devs = retSalaPorId(c, 'devs')!;
    expect(devs.w).toBe(256);
    expect(ladoDireito(devs.x + 10)).toBe(true);
    expect(ladoDireito(BX * TILE + 10)).toBe(false);
    // toque no meio da sala devs (direita, fileira sul do 1º bloco) → a própria devs
    expect(retSala(ti, true, devs.y + devs.h / 2)).toEqual(devs);
    // placa (sem toque): a sala da esquerda do 1º bloco
    expect(retSala(ti, false)).toEqual(retSalaPorId(c, 'manager'));
    expect(andarEm(c, devs.y + 5)?.id).toBe('ti');
    expect(retSalaPorId(c, 'nao-existe')).toBeNull();
  });
});

