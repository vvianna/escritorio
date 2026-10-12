// Viagens do Prédio (specs/predio-vertical.md, D6 e D11): compara um snapshot com o anterior e decide quem muda de
// andar e por quê (entrega de cartão, portão ao Victor, persona com pedido). Só funções puras, sem DOM nem relógio.

import { exemploPredio, PERSONAS, salaDe, type AgentePredio, type AndarId, type EstadoCartao } from '../ui/predio-model';

/** Quanto tempo a memória guarda um cartão que deixou de aparecer no snapshot. */
export const MEMORIA_MS = 15 * 60 * 1000;
/** Máximo de viagens pendentes; as que passarem disso são resolvidas na hora (D7). */
export const MAX_PENDENTES = 6;
/** Ciclo do roteiro de demonstração (3 cenas de 12 s). */
export const CICLO_DEMO_MS = 36_000;

export type Viagem =
  | { tipo: 'entrega'; chave: string; quem: string | null; dePerfil: string; paraPerfil: string; de: AndarId; para: AndarId; destino?: string }
  | { tipo: 'portao'; chave: string; quem: string; de: AndarId; para: 'cobertura' }
  | { tipo: 'persona'; chave: string; quem: string; paraPerfil: string; de: 'terreo'; para: AndarId; destino?: string };

interface Lembranca {
  perfil: string;
  agentId: string;
  andar: AndarId;
  estado: EstadoCartao;
  criadoPor?: string;
  vistoEm: number;
}

const perfilDe = (a: AgentePredio) => a.hermesProfile ?? a.name;
const ehHermes = (a: AgentePredio) => a.provider === 'hermes' && (!a.kind || a.kind === 'main');

/** Personagem da função (sem vaga): `hermesProfile === perfil` sem `hermesSlot`, ou `name === perfil`. */
function personagemDaFuncao(agentes: readonly AgentePredio[], perfil: string): AgentePredio | undefined {
  return agentes.find((a) => ehHermes(a) && ((a.hermesProfile === perfil && a.hermesSlot == null) || a.name === perfil));
}

export class MemoriaCartoes {
  private memoria = new Map<string, Lembranca>();
  private carregada = false;
  private pendentes = new Map<string, Viagem>();
  /** Viagens da última `atualizar` que passaram de MAX_PENDENTES: resolver na hora, sem animação. */
  resolverNaHora: Viagem[] = [];

  /** Quantas viagens devolvidas ainda não foram concluídas. */
  get emAndamento(): number {
    return this.pendentes.size;
  }

  /** A cena avisa que a viagem terminou (animada ou resolvida); libera a vaga e o portão. */
  concluir(v: Viagem): void {
    this.pendentes.delete(idViagem(v));
  }

  atualizar(agentes: readonly AgentePredio[], agora: number): Viagem[] {
    const atuais = new Map<string, { a: AgentePredio; perfil: string }>();
    for (const a of agentes) {
      if (!ehHermes(a) || !a.hermes) continue;
      const perfil = perfilDe(a);
      if (PERSONAS.has(perfil)) continue;
      const chave = `${a.hermes.board}/${a.hermes.taskId}`;
      if (!atuais.has(chave)) atuais.set(chave, { a, perfil });
    }

    const novas: Viagem[] = [];
    let portaoChave: string | undefined;
    if (this.carregada) {
      for (const [chave, { a, perfil }] of atuais) {
        const antes = this.memoria.get(chave);
        const andar = salaDe(perfil).andar;
        const c = a.hermes!;
        if (antes && antes.perfil !== perfil && antes.andar !== andar) {
          const quem = agentes.find((x) => x.id === antes.agentId)?.id ?? personagemDaFuncao(agentes, antes.perfil)?.id ?? null;
          novas.push({ tipo: 'entrega', chave, quem, dePerfil: antes.perfil, paraPerfil: perfil, de: antes.andar, para: andar, destino: a.id });
        }
        if (c.state === 'blocked' && antes?.estado !== 'blocked') portaoChave ??= chave;
        if (!antes && c.criadoPor && PERSONAS.has(c.criadoPor) && andar !== 'terreo') {
          novas.push({ tipo: 'persona', chave, quem: `persona:${c.criadoPor}`, paraPerfil: perfil, de: 'terreo', para: andar, destino: a.id });
        }
      }
      const portaoAndando = [...this.pendentes.values()].some((v) => v.tipo === 'portao');
      if (portaoChave && !portaoAndando) {
        const manager = personagemDaFuncao(agentes, 'default') ?? agentes.find((x) => ehHermes(x) && perfilDe(x) === 'default');
        if (manager) novas.push({ tipo: 'portao', chave: portaoChave, quem: manager.id, de: salaDe('default').andar, para: 'cobertura' });
      }
    }

    for (const [chave, { a, perfil }] of atuais) {
      const c = a.hermes!;
      this.memoria.set(chave, { perfil, agentId: a.id, andar: salaDe(perfil).andar, estado: c.state, criadoPor: c.criadoPor, vistoEm: agora });
    }
    for (const [chave, l] of this.memoria) if (!atuais.has(chave) && agora - l.vistoEm > MEMORIA_MS) this.memoria.delete(chave);
    this.carregada = true;

    const vagas = Math.max(0, MAX_PENDENTES - this.pendentes.size);
    const devolvidas = novas.slice(0, vagas);
    this.resolverNaHora = novas.slice(vagas);
    for (const v of devolvidas) this.pendentes.set(idViagem(v), v);
    return devolvidas;
  }
}

/** O mesmo cartão pode gerar entrega e portão no mesmo snapshot: a pendente é indexada por tipo + chave. */
const idViagem = (v: Viagem) => `${v.tipo}:${v.chave}`;

/**
 * Roteiro de demonstração (`?mock=1&vista=predio&viagens=demo`, D11): a partir de `exemploPredio().agentes`, um ciclo
 * de 36 s com 3 cenas de 12 s: entrega TI → 3º, portão (Manager sobe), persona (vini sobe do Térreo). Do 2º ciclo em
 * diante as chaves de demo ganham o sufixo `-c<n>`, para a persona ser de novo um cartão "nunca visto".
 */
export function roteiroDemo(t0: number): (agora: number) => AgentePredio[] {
  return (agora) => {
    const dt = Math.max(0, agora - t0);
    const ciclo = Math.floor(dt / CICLO_DEMO_MS);
    const t = dt % CICLO_DEMO_MS;
    const id = (base: string) => (ciclo ? `${base}-c${ciclo}` : base);
    const agentes = exemploPredio(t0).agentes.map((a): AgentePredio => (a.hermes ? { ...a, hermes: { ...a.hermes } } : { ...a }));
    const produto: AgentePredio = { id: 'h:produto', provider: 'hermes', name: 'produto' };
    agentes.push(produto);

    // Cena 1 (0–12 s): t_demo1 com o Santos Dumont (dev, TI) até 2 s, depois com o produto (3º) até 12 s.
    const demo1 = { board: 'escritorio', taskId: id('t_demo1'), title: 'Tela de custos: pronta para o produto', state: 'running' as const };
    if (t < 2_000) agentes.find((a) => a.id === 'h:dev')!.hermes = demo1;
    else if (t < 12_000) produto.hermes = demo1;

    // Cena 2 (12–24 s): o cartão do architect roda até 14 s e trava (blocked) daí em diante no ciclo.
    const architect = agentes.find((a) => a.id === 'h:architect')!.hermes!;
    if (t < 14_000) {
      architect.state = 'running';
      delete architect.reason;
    }

    // Cena 3 (24–36 s): aparece t_demo3 no produto, criado pela persona vini, a partir de 26 s.
    if (t >= 26_000) produto.hermes = { board: 'escritorio', taskId: id('t_demo3'), title: 'Pedido do vini: relatório do mês', state: 'running', criadoPor: 'vini' };
    return agentes;
  };
}
