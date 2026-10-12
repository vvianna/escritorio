import { describe, expect, it } from 'vitest';
import { roomTheme } from '../art/theme';
import { exemploPredio, montarPredio, type AgentePredio } from '../ui/predio-model';
import { Bonecos, SUMIR_MS } from './bonecos';
import { montarCena } from './planta';

const art = { roomTheme, appearanceFromSeed: () => ({}) as never };

function vista(agentes: AgentePredio[]) {
  return montarPredio(agentes, null);
}

describe('Bonecos.reconciliar (por agentId)', () => {
  const base = exemploPredio(0).agentes;
  const cena = montarCena(vista(base), art);

  it('cria um boneco por ocupante, com id = agentId', () => {
    const bs = new Bonecos(cena, art);
    const v = vista(base);
    bs.reconciliar(v, 0);
    const n = v.andares.flatMap((a) => a.salas).flatMap((s) => s.ocupantes).length;
    expect(bs.lista).toHaveLength(n);
    expect(bs.lista.some((b) => b.id === 'h:dev')).toBe(true);
  });

  it('mantém o mesmo boneco e a mesma mesa quando o estado muda', () => {
    const bs = new Bonecos(cena, art);
    bs.reconciliar(vista(base), 0);
    const antes = bs.lista.find((b) => b.id === 'h:dev')!;
    const mesa = antes.mesa?.id;
    expect(mesa).toBeTruthy();
    expect(antes.modo).toBe('mesa');
    const parado = base.map((a) => (a.id === 'h:dev' ? { ...a, hermes: undefined } : a));
    bs.reconciliar(vista(parado), 100);
    const depois = bs.lista.find((b) => b.id === 'h:dev')!;
    expect(depois).toBe(antes);
    expect(depois.mesa?.id).toBe(mesa);
    expect(depois.modo).not.toBe('mesa');
    bs.reconciliar(vista(base), 200);
    expect(bs.lista.find((b) => b.id === 'h:dev')!.mesa?.id).toBe(mesa);
  });

  it('quem chegou entra; quem sumiu fica até SUMIR_MS e depois sai', () => {
    const bs = new Bonecos(cena, art);
    const sem = base.filter((a) => a.id !== 'h:qa');
    bs.reconciliar(vista(sem), 0);
    expect(bs.lista.some((b) => b.id === 'h:qa')).toBe(false);
    bs.reconciliar(vista(base), 10);
    expect(bs.lista.some((b) => b.id === 'h:qa')).toBe(true);
    bs.reconciliar(vista(sem), 1000);
    expect(bs.lista.some((b) => b.id === 'h:qa')).toBe(true);
    bs.expirar(1000 + SUMIR_MS);
    expect(bs.lista.some((b) => b.id === 'h:qa')).toBe(true);
    bs.expirar(1001 + SUMIR_MS);
    expect(bs.lista.some((b) => b.id === 'h:qa')).toBe(false);
  });

  it('quem volta antes de SUMIR_MS é o mesmo boneco', () => {
    const bs = new Bonecos(cena, art);
    bs.reconciliar(vista(base), 0);
    const qa = bs.lista.find((b) => b.id === 'h:qa');
    bs.reconciliar(vista(base.filter((a) => a.id !== 'h:qa')), 100);
    bs.reconciliar(vista(base), 200);
    expect(bs.lista.find((b) => b.id === 'h:qa')).toBe(qa);
    expect(qa!.sumiuEm).toBeUndefined();
  });

  it('duas pessoas nunca dividem a mesma mesa', () => {
    const bs = new Bonecos(cena, art);
    bs.reconciliar(vista(base), 0);
    const mesas = bs.lista.flatMap((b) => (b.mesa ? [b.mesa.id] : []));
    expect(new Set(mesas).size).toBe(mesas.length);
  });
});
