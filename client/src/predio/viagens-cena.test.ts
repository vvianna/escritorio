// S8 (specs/predio-vertical.md, D5–D7): viagens animadas na cena — o boneco anda até a fila, entra na cabine, sai no
// andar novo e entrega; ninguém troca de andar sem passar pelo elevador (inclusive o passeio à toa).
import { describe, expect, it } from 'vitest';
import { roomTheme } from '../art/theme';
import { exemploPredio, montarPredio, type AgentePredio } from '../ui/predio-model';
import { PathFinder } from '../world/path/astar';
import { CAPACIDADE } from './elevador';
import { Bonecos, type Boneco } from './bonecos';
import { LAJE, montarCena, type Cena } from './planta';
import { TILE } from '../art/api';
import { MemoriaCartoes, roteiroDemo, type Viagem } from './viagens';

const art = { roomTheme, appearanceFromSeed: () => ({}) as never };

function semente(s = 7) {
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 0xffffffff;
}

interface Sim {
  cena: Cena;
  bs: Bonecos;
  pf: PathFinder;
  t: number;
  feitas: Viagem[];
  encerradas: Viagem[];
  maxCarga: number;
  /** Quem foi visto fora do próprio andar (fora da cabine) — tem de ficar vazio. */
  furos: string[];
  /** Andares em que cada boneco esteve. */
  andares: Map<string, Set<string>>;
  rodar(ms: number, cada?: () => void): void;
}

function simular(agentes: AgentePredio[]): Sim {
  const cena = montarCena(montarPredio(agentes, null), art);
  const bs = new Bonecos(cena, art);
  bs.reconciliar(montarPredio(agentes, null), 0);
  const rnd = semente();
  const s: Sim = {
    cena,
    bs,
    pf: new PathFinder(cena.grid),
    t: 0,
    feitas: [],
    encerradas: [],
    maxCarga: 0,
    furos: [],
    andares: new Map(),
    rodar(ms, cada) {
      const fim = s.t + ms;
      while (s.t < fim) {
        s.t += 50;
        bs.passo(0.05, s.t, s.pf, rnd);
        s.maxCarga = Math.max(s.maxCarga, bs.elevador.carga.length);
        for (const b of bs.lista) conferirAndar(s, b);
        cada?.();
      }
    },
  };
  bs.aoTerminar = (v, animada) => (animada ? s.feitas : s.encerradas).push(v);
  return s;
}

/** Fora da cabine, o boneco está dentro da faixa do andar em que diz estar (do fim da laje ao fim do andar). */
function conferirAndar(s: Sim, b: Boneco): void {
  if (b.dentro) return;
  const a = s.cena.andares.find((x) => x.id === b.onde)!;
  const ty = (b.y - 4) / TILE;
  if (ty < a.y0 + LAJE - 0.5 || ty > a.y1 + 0.5) s.furos.push(`${b.id} em y=${ty.toFixed(1)} fora de ${a.id}`);
  if (!s.andares.has(b.id)) s.andares.set(b.id, new Set());
  s.andares.get(b.id)!.add(b.onde);
}

const base = () => exemploPredio(0).agentes.map((a) => ({ ...a }));

describe('viagens na cena (S8)', () => {
  it('entrega TI → 3º: anda até a fila, sobe na cabine, entrega o 📦 ao produto e volta à mesa', () => {
    const ag = base();
    ag.push({ id: 'h:produto', provider: 'hermes', name: 'produto' });
    const s = simular(ag);
    const dev = s.bs.lista.find((b) => b.id === 'h:dev')!;
    const mesa = { x: dev.mesa!.x, y: dev.mesa!.y };
    const v: Viagem = { tipo: 'entrega', chave: 'escritorio/t_x', quem: 'h:dev', dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' };
    expect(s.bs.iniciar(v, 0)).toBe(true);
    expect(dev.held).toBe('box');
    let chegouEm = 0;
    let viuNaCabine = false;
    let produtoComCaixa = false;
    s.rodar(60_000, () => {
      if (dev.dentro) viuNaCabine = true;
      if (!chegouEm && s.feitas.length) chegouEm = s.t;
      if (s.bs.lista.find((b) => b.id === 'h:produto')!.held === 'box') produtoComCaixa = true;
    });
    expect(viuNaCabine).toBe(true);
    expect(s.feitas).toEqual([v]);
    expect(produtoComCaixa).toBe(true);
    // chega ao andar novo em menos de 15 s (o roteiro de demonstração troca de cena a cada 12 s)
    expect(chegouEm).toBeGreaterThan(0);
    expect(chegouEm).toBeLessThan(15_000);
    expect(s.andares.get('h:dev')).toEqual(new Set(['ti', 'produto']));
    expect(dev.rot).toBeUndefined();
    expect(dev.onde).toBe('ti');
    expect(Math.abs(dev.x - mesa.x) + Math.abs(dev.y - mesa.y)).toBeLessThan(TILE);
    expect(s.furos).toEqual([]);
  });

  it('portão: o Manager sobe à Cobertura com papéis, fica na Mesa do Victor e volta', () => {
    const s = simular(base());
    const v: Viagem = { tipo: 'portao', chave: 'hermes-lab/t_a', quem: 'h:default', de: 'ti', para: 'cobertura' };
    expect(s.bs.iniciar(v, 0)).toBe(true);
    const mgr = s.bs.lista.find((b) => b.id === 'h:default')!;
    expect(mgr.held).toBe('papers');
    let chegouEm = 0;
    s.rodar(60_000, () => {
      if (!chegouEm && s.feitas.length) chegouEm = s.t;
    });
    expect(s.andares.get('h:default')).toEqual(new Set(['ti', 'cobertura']));
    expect(chegouEm).toBeLessThan(15_000);
    expect(mgr.onde).toBe('ti');
    expect(mgr.modo).toBe('mesa');
    expect(s.furos).toEqual([]);
  });

  it('persona: o vini sai da Recepção, sobe ao 3º, entrega e volta ao Térreo', () => {
    const ag = base();
    ag.push({ id: 'h:produto', provider: 'hermes', name: 'produto' });
    const s = simular(ag);
    const v: Viagem = { tipo: 'persona', chave: 'escritorio/t_p', quem: 'persona:vini', paraPerfil: 'produto', de: 'terreo', para: 'produto', destino: 'h:produto' };
    expect(s.bs.iniciar(v, 0)).toBe(true);
    let chegouEm = 0;
    s.rodar(60_000, () => {
      if (!chegouEm && s.feitas.length) chegouEm = s.t;
    });
    const vini = s.bs.lista.find((b) => b.o.perfil === 'vini')!;
    expect(s.andares.get(vini.id)).toEqual(new Set(['terreo', 'produto']));
    expect(chegouEm).toBeLessThan(15_000);
    expect(vini.onde).toBe('terreo');
    expect(s.furos).toEqual([]);
  });

  it('📦 sozinho (quem = null): viaja na cabine e quem recebe busca na porta', () => {
    const ag = base();
    ag.push({ id: 'h:produto', provider: 'hermes', name: 'produto' });
    const s = simular(ag);
    const v: Viagem = { tipo: 'entrega', chave: 'escritorio/t_n', quem: null, dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' };
    expect(s.bs.iniciar(v, 0)).toBe(true);
    expect(s.bs.caixas).toHaveLength(1);
    let naCabine = false;
    let buscou = false;
    s.rodar(30_000, () => {
      if (s.bs.elevador.carga.includes('caixa:escritorio/t_n')) naCabine = true;
      if (s.bs.lista.find((b) => b.id === 'h:produto')!.held === 'box') buscou = true;
    });
    expect(naCabine).toBe(true);
    expect(s.feitas).toEqual([v]);
    expect(buscou).toBe(true);
    expect(s.bs.caixas).toHaveLength(0);
    expect(s.furos).toEqual([]);
  });

  it('fila na porta: 5 de uma vez, no máximo 3 na cabine, todos entregam', () => {
    const ag = base().map((a) => (a.hermes ? { ...a, hermes: { ...a.hermes, state: 'running' as const } } : a));
    ag.push({ id: 'h:produto', provider: 'hermes', name: 'produto' });
    const s = simular(ag);
    const quem = ['h:dev', 'h:devcodex', 'h:devgemini', 'h:reviewer', 'h:deployer'];
    for (const q of quem) {
      const v: Viagem = { tipo: 'entrega', chave: `b/${q}`, quem: q, dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' };
      expect(s.bs.iniciar(v, 0)).toBe(true);
    }
    let filaMax = 0;
    s.rodar(90_000, () => (filaMax = Math.max(filaMax, s.bs.elevador.fila(s.bs.indice('ti')).length)));
    expect(s.maxCarga).toBe(CAPACIDADE);
    expect(filaMax).toBeGreaterThan(0);
    expect(s.feitas).toHaveLength(5);
    expect(s.furos).toEqual([]);
  });

  it('resolverTudo: todos em casa, cabine vazia e as viagens abertas encerradas sem animação', () => {
    const s = simular(base());
    const v: Viagem = { tipo: 'portao', chave: 'hermes-lab/t_a', quem: 'h:default', de: 'ti', para: 'cobertura' };
    s.bs.iniciar(v, 0);
    s.rodar(4_000);
    expect(s.bs.resolverTudo()).toEqual([v]);
    expect(s.encerradas).toEqual([v]);
    expect(s.bs.elevador.carga).toHaveLength(0);
    const mgr = s.bs.lista.find((b) => b.id === 'h:default')!;
    expect(mgr.rot).toBeUndefined();
    expect(mgr.onde).toBe('ti');
    expect(mgr.modo).toBe('mesa');
  });

  it('quem sumiu do snapshot no meio da viagem termina a ida e some na volta', () => {
    const ag = base();
    ag.push({ id: 'h:produto', provider: 'hermes', name: 'produto' });
    const s = simular(ag);
    const v: Viagem = { tipo: 'entrega', chave: 'escritorio/t_x', quem: 'h:dev', dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' };
    s.bs.iniciar(v, 0);
    s.bs.reconciliar(montarPredio(ag.filter((a) => a.id !== 'h:dev'), null), 100);
    s.rodar(60_000, () => s.bs.expirar(s.t));
    expect(s.feitas).toEqual([v]);
    expect(s.bs.lista.some((b) => b.id === 'h:dev')).toBe(false);
  });

  it('passeio à toa: quem vai à copa de outro andar pega o elevador; ninguém cruza a laje andando', () => {
    // todo mundo sem cartão (à toa): passeiam pelo andar e às vezes vão à copa do 3º
    const ag = base().map((a) => ({ ...a, hermes: undefined }));
    const s = simular(ag);
    const pegaram = new Set<string>();
    s.rodar(180_000, () => {
      for (const id of s.bs.elevador.carga) pegaram.add(id);
    });
    expect(s.furos).toEqual([]);
    expect(pegaram.size).toBeGreaterThan(0);
    // quem esteve em mais de um andar entrou na cabine
    const mudaram = [...s.andares].filter(([, a]) => a.size > 1).map(([id]) => id);
    expect(mudaram.length).toBeGreaterThan(0);
    for (const id of mudaram) expect(pegaram.has(id)).toBe(true);
    // e os caminhos andados nunca passam por tile de outro andar (a grade não liga os andares fora do poço)
    for (const a of s.cena.andares)
      for (const b of s.cena.andares) {
        if (a === b) continue;
        const pa = s.cena.paradas[a.id].porta;
        const pb = s.cena.paradas[b.id].porta;
        expect(s.pf.find(pa.tx, pa.ty, pb.tx, pb.ty, [])).toBe(false);
      }
  });

  it('roteiro de demonstração + MemoriaCartoes: as 3 viagens do ciclo são entregues em ~40 s', () => {
    const demo = roteiroDemo(0);
    const s = simular(demo(0));
    const mem = new MemoriaCartoes();
    mem.atualizar(demo(0), 0);
    const pendentes: Viagem[] = [];
    s.rodar(40_000, () => {
      if (s.t % 500) return;
      const ag = demo(s.t);
      const novas = mem.atualizar(ag, s.t);
      s.bs.reconciliar(montarPredio(ag, null), s.t);
      pendentes.push(...novas);
      for (const v of [...pendentes]) {
        if (s.bs.ocupado(v)) continue;
        pendentes.splice(pendentes.indexOf(v), 1);
        expect(s.bs.iniciar(v, s.t)).toBe(true);
      }
    });
    expect(s.feitas.map((v) => v.tipo)).toEqual(['entrega', 'portao', 'persona']);
    expect(s.maxCarga).toBeGreaterThanOrEqual(1);
    expect(s.maxCarga).toBeLessThanOrEqual(CAPACIDADE);
    expect(s.furos).toEqual([]);
  });
});
