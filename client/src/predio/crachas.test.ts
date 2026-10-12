import { describe, expect, it } from 'vitest';
import { posicionarCrachas, sobrepoe, type ItemCracha } from './crachas';

const limite = { x: 4, y: 4, w: 367, h: 700 };
const item = (id: string, x: number, y: number, extra: Partial<ItemCracha> = {}): ItemCracha => ({
  id,
  cabeca: { x, y },
  pes: { x, y: y + 30 },
  w: 60,
  h: 18,
  sentado: true,
  ...extra,
});
const ret = (p: { x: number; y: number }, it: ItemCracha) => ({ x: p.x, y: p.y, w: it.w, h: it.h });

describe('crachás (D4)', () => {
  it('sem obstáculo: centrado acima da cabeça, 4 px de folga', () => {
    const it = item('a', 100, 200);
    const [p] = posicionarCrachas([it], [], limite);
    expect(p).toEqual({ id: 'a', x: 70, y: 200 - 18 - 4, sobreposicao: 0 });
  });

  it('crachá sobre mesa vai para baixo dos pés', () => {
    const it = item('a', 100, 200);
    const mesa = { x: 50, y: 150, w: 100, h: 48 }; // ocupa tudo acima da cabeça
    const [p] = posicionarCrachas([it], [mesa], limite);
    expect(p!.y).toBe(230 + 4);
    expect(p!.x).toBe(70);
    expect(p!.sobreposicao).toBe(0);
    expect(sobrepoe(ret(p!, it), mesa)).toBe(0);
  });

  it('dois crachás vizinhos não se cobrem', () => {
    const a = item('a', 100, 200);
    const b = item('b', 120, 205);
    const ps = posicionarCrachas([a, b], [], limite);
    expect(ps.every((p) => p.sobreposicao === 0)).toBe(true);
    expect(sobrepoe(ret(ps[0]!, a), ret(ps[1]!, b))).toBe(0);
  });

  it('vários na mesma sala com o nome da sala: ninguém cobre a placa nem outro crachá', () => {
    const placa = { x: 60, y: 160, w: 80, h: 15 };
    const its = [item('a', 90, 200), item('b', 110, 200), item('c', 130, 205), item('d', 100, 215)];
    const ps = posicionarCrachas(its, [placa], limite);
    const rs = ps.map((p) => ret(p, its.find((i) => i.id === p.id)!));
    expect(ps.every((p) => p.sobreposicao === 0)).toBe(true);
    for (const r of rs) expect(sobrepoe(r, placa)).toBe(0);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(sobrepoe(rs[i]!, rs[j]!)).toBe(0);
  });

  it('crachá na borda é preso dentro do limite', () => {
    const esq = item('e', 2, 300);
    const dir = item('d', 372, 300);
    const topo = item('t', 200, 6);
    const ps = posicionarCrachas([esq, dir, topo], [], limite);
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(limite.x);
      expect(p.x + 60).toBeLessThanOrEqual(limite.x + limite.w);
      expect(p.y).toBeGreaterThanOrEqual(limite.y);
      expect(p.y + 18).toBeLessThanOrEqual(limite.y + limite.h);
    }
    // perto do topo, acima da cabeça não cabe: vai para baixo dos pés
    expect(ps.find((p) => p.id === 't')!.y).toBe(36 + 4);
  });

  it('sem lugar livre: fica a de menor sobreposição e diz quanto', () => {
    const it = item('a', 100, 200);
    const tudo = { x: 0, y: 0, w: 400, h: 800 };
    const [p] = posicionarCrachas([it], [tudo], limite);
    expect(p!.sobreposicao).toBe(60 * 18);
  });

  it('sem lugar livre: cobre móvel antes de cobrir placa ou outro crachá (duros)', () => {
    // à esquerda só tem móvel, à direita só placa; nada mais cabe
    const it = item('a', 100, 200);
    const movel = { x: 0, y: 0, w: 100, h: 800 };
    const placa = { x: 100, y: 0, w: 300, h: 800 };
    const [p] = posicionarCrachas([it], [movel], limite, [placa], 0);
    expect(sobrepoe(ret(p!, it), placa)).toBeLessThan(sobrepoe(ret(p!, it), movel));
  });

  it('sala cheia: com busca, acha o chão livre mais longe da cabeça; sem busca, não', () => {
    const it = item('a', 100, 200);
    // tudo ocupado em volta, menos uma faixa livre de 80 px, 90 px à direita
    const obst = [{ x: 0, y: 0, w: 160, h: 800 }, { x: 240, y: 0, w: 160, h: 800 }];
    const [semBusca] = posicionarCrachas([it], obst, limite, [], 0);
    expect(semBusca!.sobreposicao).toBeGreaterThan(0);
    const [comBusca] = posicionarCrachas([it], obst, limite, [], 96);
    expect(comBusca!.sobreposicao).toBe(0);
    expect(comBusca!.x).toBeGreaterThanOrEqual(160);
  });

  it('sentados primeiro: quem anda desvia de quem está na mesa', () => {
    const andando = item('w', 100, 200, { sentado: false });
    const sentado = item('s', 100, 200);
    const ps = posicionarCrachas([andando, sentado], [], limite);
    expect(ps[0]!.id).toBe('s');
    expect(ps.find((p) => p.id === 's')!.y).toBe(178);
    expect(ps.find((p) => p.id === 'w')!.y).not.toBe(178);
  });
});
