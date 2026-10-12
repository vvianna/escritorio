import { describe, expect, it } from 'vitest';
import type { AgentePredio, EstadoCartao } from '../ui/predio-model';
import { CICLO_DEMO_MS, MAX_PENDENTES, MEMORIA_MS, MemoriaCartoes, roteiroDemo, type Viagem } from './viagens';

const cartao = (taskId: string, state: EstadoCartao = 'running', criadoPor?: string) => ({
  board: 'escritorio',
  taskId,
  title: `cartão ${taskId}`,
  state,
  ...(criadoPor ? { criadoPor } : {}),
});
const agente = (id: string, name: string, extra: Partial<AgentePredio> = {}): AgentePredio => ({ id, provider: 'hermes', name, ...extra });
const trabalhador = (id: string, perfil: string, slot: number, taskId: string, state: EstadoCartao = 'running') =>
  agente(id, `Vaga ${slot} (${perfil})`, { hermesProfile: perfil, hermesSlot: slot, hermes: cartao(taskId, state) });

const manager = agente('h:default', 'default');
const devFuncao = agente('h:dev', 'dev');

describe('MemoriaCartoes', () => {
  it('1ª chamada só carrega a memória e devolve []', () => {
    const m = new MemoriaCartoes();
    expect(m.atualizar([manager, trabalhador('w:dev1', 'dev', 1, 't_1', 'blocked')], 0)).toEqual([]);
  });

  it('dev (TI) → produto (3º) gera entrega com quem = o trabalhador', () => {
    const m = new MemoriaCartoes();
    m.atualizar([manager, devFuncao, trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    const v = m.atualizar([manager, devFuncao, trabalhador('w:dev1', 'dev', 1, 't_2'), agente('h:produto', 'produto', { hermes: cartao('t_1') })], 1000);
    expect(v).toEqual([
      { tipo: 'entrega', chave: 'escritorio/t_1', quem: 'w:dev1', dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' },
    ]);
  });

  it('trabalhador sumido → quem = personagem da função', () => {
    const m = new MemoriaCartoes();
    m.atualizar([devFuncao, trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    const v = m.atualizar([devFuncao, agente('h:produto', 'produto', { hermes: cartao('t_1') })], 1000);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tipo: 'entrega', quem: 'h:dev', destino: 'h:produto' });
  });

  it('personagem da função também vale por hermesProfile sem vaga', () => {
    const m = new MemoriaCartoes();
    m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    const v = m.atualizar([agente('h:dev', 'Oswaldo Cruz (dev)', { hermesProfile: 'dev' }), agente('h:produto', 'produto', { hermes: cartao('t_1') })], 1000);
    expect(v[0]).toMatchObject({ tipo: 'entrega', quem: 'h:dev' });
  });

  it('sem trabalhador nem personagem → quem: null', () => {
    const m = new MemoriaCartoes();
    m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    const v = m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_1') })], 1000);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tipo: 'entrega', quem: null, de: 'ti', para: 'produto' });
  });

  it('dev → reviewer (mesmo andar) não gera nada', () => {
    const m = new MemoriaCartoes();
    m.atualizar([manager, trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    expect(m.atualizar([manager, agente('h:reviewer', 'reviewer', { hermes: cartao('t_1') })], 1000)).toEqual([]);
  });

  it('running → blocked gera 1 portão (2 no mesmo snapshot = 1)', () => {
    const m = new MemoriaCartoes();
    m.atualizar([manager, trabalhador('w:dev1', 'dev', 1, 't_1'), agente('h:architect', 'architect', { hermes: cartao('t_2') })], 0);
    const v = m.atualizar([manager, trabalhador('w:dev1', 'dev', 1, 't_1', 'blocked'), agente('h:architect', 'architect', { hermes: cartao('t_2', 'blocked') })], 1000);
    expect(v).toEqual([{ tipo: 'portao', chave: 'escritorio/t_1', quem: 'h:default', de: 'ti', para: 'cobertura' }]);
    // continua blocked: nada de novo
    expect(m.atualizar([manager, trabalhador('w:dev1', 'dev', 1, 't_1', 'blocked'), agente('h:architect', 'architect', { hermes: cartao('t_2', 'blocked') })], 2000)).toEqual([]);
  });

  it('com portão pendente não cria outro; depois de concluir, cria', () => {
    const m = new MemoriaCartoes();
    m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1') }), agente('h:architect', 'architect', { hermes: cartao('t_2') })], 0);
    const [p] = m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1', 'blocked') }), agente('h:architect', 'architect', { hermes: cartao('t_2') })], 1000);
    expect(p?.tipo).toBe('portao');
    expect(m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1', 'blocked') }), agente('h:architect', 'architect', { hermes: cartao('t_2', 'blocked') })], 2000)).toEqual([]);
    m.concluir(p!);
    m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1', 'blocked') }), agente('h:architect', 'architect', { hermes: cartao('t_2') })], 3000);
    const v = m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1', 'blocked') }), agente('h:architect', 'architect', { hermes: cartao('t_2', 'blocked') })], 4000);
    expect(v).toEqual([{ tipo: 'portao', chave: 'escritorio/t_2', quem: 'h:default', de: 'ti', para: 'cobertura' }]);
  });

  it('o amarelo "internal" (guarded/delivering) não faz o Manager subir', () => {
    const m = new MemoriaCartoes();
    m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1') })], 0);
    expect(m.atualizar([manager, agente('h:qa', 'qa', { hermes: cartao('t_1', 'guarded') })], 1000)).toEqual([]);
  });

  it('sem default no snapshot → nenhum portão', () => {
    const m = new MemoriaCartoes();
    m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    expect(m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1', 'blocked')], 1000)).toEqual([]);
  });

  it('chave nova com criadoPor: vini no produto gera persona', () => {
    const m = new MemoriaCartoes();
    m.atualizar([agente('h:produto', 'produto')], 0);
    const v = m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_9', 'running', 'vini') })], 1000);
    expect(v).toEqual([{ tipo: 'persona', chave: 'escritorio/t_9', quem: 'persona:vini', paraPerfil: 'produto', de: 'terreo', para: 'produto', destino: 'h:produto' }]);
  });

  it('persona: sem criadoPor, criador que não é persona ou chave já vista → nada', () => {
    const m = new MemoriaCartoes();
    m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_1', 'running', 'vini') })], 0);
    expect(m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_1', 'running', 'vini') })], 1000)).toEqual([]);
    expect(m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_2') })], 2000)).toEqual([]);
    expect(m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_3', 'running', 'architect') })], 3000)).toEqual([]);
  });

  it('cartão que some e volta antes de 15 min com outro perfil ainda gera entrega', () => {
    const m = new MemoriaCartoes();
    m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    m.atualizar([], 1000);
    const v = m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_1') })], 1000 + MEMORIA_MS - 1);
    expect(v[0]).toMatchObject({ tipo: 'entrega', chave: 'escritorio/t_1' });
  });

  it('chave esquecida depois de 15 min não gera entrega', () => {
    const m = new MemoriaCartoes();
    m.atualizar([trabalhador('w:dev1', 'dev', 1, 't_1')], 0);
    m.atualizar([], MEMORIA_MS + 1);
    expect(m.atualizar([agente('h:produto', 'produto', { hermes: cartao('t_1') })], MEMORIA_MS + 2)).toEqual([]);
  });

  it('7 viagens de uma vez → 6 devolvidas e 1 marcada para resolver na hora', () => {
    const m = new MemoriaCartoes();
    const ids = Array.from({ length: 7 }, (_, i) => `t_${i + 1}`);
    m.atualizar(ids.map((t, i) => trabalhador(`w:dev${i + 1}`, 'dev', i + 1, t)), 0);
    const v = m.atualizar(ids.map((t, i) => trabalhador(`w:prod${i + 1}`, 'produto', i + 1, t)), 1000);
    expect(MAX_PENDENTES).toBe(6);
    expect(v).toHaveLength(6);
    expect(v.every((x) => x.tipo === 'entrega')).toBe(true);
    expect(m.resolverNaHora).toHaveLength(1);
    expect(m.resolverNaHora[0]).toMatchObject({ tipo: 'entrega', chave: 'escritorio/t_7' });
    expect(m.emAndamento).toBe(6);
    // sem vagas: a próxima vai direto para resolver na hora; concluir uma libera a vaga
    m.atualizar([trabalhador('w:dev9', 'dev', 9, 't_9')], 2000);
    expect(m.atualizar([trabalhador('w:prod9', 'produto', 9, 't_9')], 3000)).toEqual([]);
    expect(m.resolverNaHora).toHaveLength(1);
    m.concluir(v[0]!);
    m.atualizar([trabalhador('w:dev9', 'dev', 9, 't_10')], 4000);
    expect(m.atualizar([trabalhador('w:prod9', 'produto', 9, 't_10')], 5000)).toHaveLength(1);
    expect(m.resolverNaHora).toEqual([]);
  });
});

describe('roteiroDemo', () => {
  const simula = (t0: number, de: number, ate: number, passo = 500) => {
    const roteiro = roteiroDemo(t0);
    const m = new MemoriaCartoes();
    const viagens: Viagem[] = [];
    for (let t = de; t < ate; t += passo) {
      const vs = m.atualizar(roteiro(t0 + t), t0 + t);
      for (const v of vs) {
        viagens.push(v);
        m.concluir(v);
      }
    }
    return viagens;
  };

  it('produz as 3 viagens em 36 s simulados', () => {
    const v = simula(1_000_000, 0, CICLO_DEMO_MS);
    expect(v).toEqual([
      { tipo: 'entrega', chave: 'escritorio/t_demo1', quem: 'h:dev', dePerfil: 'dev', paraPerfil: 'produto', de: 'ti', para: 'produto', destino: 'h:produto' },
      { tipo: 'portao', chave: 'hermes-lab/t_24', quem: 'h:default', de: 'ti', para: 'cobertura' },
      { tipo: 'persona', chave: 'escritorio/t_demo3', quem: 'persona:vini', paraPerfil: 'produto', de: 'terreo', para: 'produto', destino: 'h:produto' },
    ]);
  });

  it('cada cena cai na sua janela de 12 s e o ciclo se repete com as mesmas 3 viagens', () => {
    const t0 = 5_000;
    const roteiro = roteiroDemo(t0);
    const m = new MemoriaCartoes();
    const quando: [string, number][] = [];
    for (let t = 0; t < 3 * CICLO_DEMO_MS; t += 500) for (const v of m.atualizar(roteiro(t0 + t), t0 + t)) {
      quando.push([v.tipo, t % CICLO_DEMO_MS]);
      m.concluir(v);
    }
    const um = [quando[0], quando[1], quando[2]];
    expect(um.map(([tipo]) => tipo)).toEqual(['entrega', 'portao', 'persona']);
    expect(um[0]![1]).toBeLessThan(12_000);
    expect(um[1]![1]).toBeGreaterThanOrEqual(12_000);
    expect(um[1]![1]).toBeLessThan(24_000);
    expect(um[2]![1]).toBeGreaterThanOrEqual(24_000);
    expect(quando).toEqual([...um, ...um, ...um]);
  });
});
