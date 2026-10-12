// Prédio do time de agentes (escritorio.md, "O prédio"): um andar por área, cada perfil do Hermes na sua sala,
// e no topo o uso por assinatura (Claude · ChatGPT · Gemini · Grok, janelas de 5 h e 7 dias).
// Só funções puras: quem está em qual andar, o estado de cada um e as linhas do painel de uso.
// Lê só o que o servidor já entrega: agentes com provider 'hermes' (sources/hermes.ts) e GET /api/hermes/uso
// (sources/hermes-uso.ts). Nada de conteúdo de conversa: personas mostram só "conversando" / "à toa".

import type { HermesModelo } from '../../../shared/types';

/** Estado do cartão de um perfil (espelha HermesCardState de shared/types.ts, fonte `hermes`). */
export type EstadoCartao = 'running' | 'blocked' | 'guarded' | 'delivering';

/** O mínimo de um agente que o prédio lê (estrutural: serve para o snapshot com e sem a fonte `hermes`). */
export interface AgentePredio {
  id: string;
  kind?: string;
  provider?: string;
  name: string;
  hermes?: { board: string; taskId: string; title: string; state: EstadoCartao; reason?: string };
  /** Função do Hermes (AgentInfo.hermesProfile); o nome pode ser o da vaga ("Oswaldo Cruz (dev)"). */
  hermesProfile?: string;
  /** Vaga do trabalhador (um por cartão running), 1 = 1ª; ausente = personagem da função. */
  hermesSlot?: number;
  /** Provedor/modelo ao vivo da cadeira (AgentInfo.hermesModelo). */
  hermesModelo?: HermesModelo;
}

/** Recorte de GET /api/hermes/uso (sources/hermes-uso.ts). */
export interface UsoProvedor {
  provedor: string;
  rotulo: string;
  total: number;
  custoEstimadoUsd: number;
}
export interface CotaAgy {
  familia: string;
  janela: string;
  restantePct: number;
}
export interface PersonaUso {
  perfil: string;
  conversando: boolean;
  ultimaAtividade?: number;
}
export interface UsoHermes {
  geradoEm: number;
  cincoHoras: UsoProvedor[];
  seteDias: UsoProvedor[];
  antigravity?: CotaAgy[];
  personas: PersonaUso[];
}

export type AndarId = 'cobertura' | 'produto' | 'ti' | 'terreo';

export interface Sala {
  id: string;
  nome: string;
  /** Detalhe do cenário (prancheta, caminhão...). */
  objeto?: string;
  perfis: string[];
}

export interface AndarDef {
  id: AndarId;
  titulo: string;
  salas: Sala[];
}

/** Planta do prédio (escritorio.md). Perfil que não aparece aqui vai para a "bancada extra" do TI. */
export const PLANTA: AndarDef[] = [
  { id: 'cobertura', titulo: 'Cobertura · Negócio', salas: [{ id: 'victor', nome: 'Mesa do Victor', objeto: 'mesa grande', perfis: [] }] },
  { id: 'produto', titulo: '3º · Produto', salas: [{ id: 'produto', nome: 'Produto', objeto: 'quadro da fila', perfis: ['produto'] }] },
  {
    id: 'ti',
    titulo: '2º · TI',
    salas: [
      { id: 'manager', nome: 'Manager', perfis: ['default'] },
      { id: 'pl-opens', nome: 'PL Opens', objeto: 'quadros OF · OH · OI', perfis: ['pl-opens'] },
      { id: 'pl-infra', nome: 'PL Infra', objeto: 'regras', perfis: ['pl-infra'] },
      { id: 'devs', nome: 'Bancada devs', perfis: ['dev', 'devcodex', 'devgemini'] },
      { id: 'architect', nome: 'Prancheta', perfis: ['architect'] },
      { id: 'qa', nome: 'Lab QA', objeto: 'celular na mão', perfis: ['qa', 'reviewer'] },
      { id: 'seguranca', nome: 'Guarita Segurança', perfis: ['judge', 'auditor'] },
      { id: 'deployer', nome: 'Doca Deployer', objeto: 'caminhão = deploy rodando', perfis: ['deployer'] },
      { id: 'plantao', nome: 'Sala Plantão', objeto: 'painel de alertas', perfis: ['plantao'] },
    ],
  },
  { id: 'terreo', titulo: 'Térreo · Personas', salas: [{ id: 'recepcao', nome: 'Recepção', perfis: ['vini', 'sergiao', 'alexa', 'sergiao-site', 'vini-chat'] }] },
];

/** Perfis de persona (térreo): nunca mostram cartão nem conversa, só "conversando" / "à toa". */
export const PERSONAS = new Set(PLANTA.find((a) => a.id === 'terreo')!.salas.flatMap((s) => s.perfis));

/** Assinaturas fixas do topo, na ordem do escritorio.md. */
export const ASSINATURAS = ['Claude', 'ChatGPT', 'Gemini', 'Grok'] as const;

/** Nome que aparece no crachá. */
export function apelido(perfil: string): string {
  return perfil === 'default' ? 'Manager' : perfil;
}

/** Em que sala o perfil fica. */
export function salaDe(perfil: string): { andar: AndarId; sala: string } {
  for (const andar of PLANTA) for (const s of andar.salas) if (s.perfis.includes(perfil)) return { andar: andar.id, sala: s.id };
  return { andar: 'ti', sala: 'extra' };
}

export type EstadoOcupante = EstadoCartao | 'cafe' | 'conversando' | 'fora';

export interface Ocupante {
  perfil: string;
  nome: string;
  estado: EstadoOcupante;
  /** Linha curta debaixo do crachá (título do cartão, "O que travou"...). */
  detalhe?: string;
  board?: string;
  agentId?: string;
  /** Selo de provedor/modelo (cartão rodando: ao vivo; à toa: último modelo usado, `ocioso`). */
  modelo?: HermesModelo;
}

export interface SalaVista {
  id: string;
  nome: string;
  objeto?: string;
  ocupantes: Ocupante[];
}

export interface AndarVista {
  id: AndarId;
  titulo: string;
  salas: SalaVista[];
  /** Placa do andar (só na cobertura: portões esperando o Victor). */
  placa?: string;
}

export interface LinhaUso {
  rotulo: string;
  cincoHoras: number;
  seteDias: number;
  custo7dUsd: number;
}

export interface PredioVista {
  andares: AndarVista[];
  uso: LinhaUso[];
  cotas: CotaAgy[];
  /** Cartões bloqueados esperando humano. */
  portoes: number;
  trabalhando: number;
  /** Fonte do Hermes desligada de verdade: o servidor respondeu 404 ao uso e não há perfil nenhum no snapshot. */
  vazio: boolean;
  /** Linha de aviso debaixo do uso (carregando, fonte desligada, falha de leitura); ausente = tudo certo. */
  aviso?: string;
}

export const ROTULO_ESTADO: Record<EstadoOcupante, string> = {
  running: 'trabalhando',
  blocked: 'precisa de você',
  guarded: 'placa vermelha',
  delivering: 'entregando ao revisor',
  cafe: 'café / à toa',
  conversando: 'conversando agora',
  fora: 'à toa',
};

/**
 * Assinatura do topo a que um billing_provider pertence. O servidor rotula o Antigravity como "Antigravity" e deixa a
 * reserva como "fallback_chain[0](anthropic)": aqui o Antigravity conta como Gemini e a reserva pelo provedor de dentro.
 */
export function assinaturaDoUso(p: UsoProvedor): string {
  const prov = (/^fallback_chain\[\d+\]\((.*)\)$/.exec(p.provedor)?.[1] ?? p.provedor).toLowerCase();
  if (prov.startsWith('anthropic') || prov.startsWith('claude')) return 'Claude';
  if (prov.startsWith('openai') || prov.startsWith('chatgpt') || prov.startsWith('codex')) return 'ChatGPT';
  if (prov.startsWith('antigravity') || prov.startsWith('agy') || prov.startsWith('google') || prov.startsWith('gemini')) return 'Gemini';
  if (prov.startsWith('xai') || prov.startsWith('grok')) return 'Grok';
  return p.rotulo;
}

/** Linhas do painel de uso: as 4 assinaturas sempre (0 quando não usou) + outras que aparecerem. */
export function linhasUso(uso: UsoHermes | null | undefined): LinhaUso[] {
  const linhas = new Map<string, LinhaUso>();
  for (const r of ASSINATURAS) linhas.set(r, { rotulo: r, cincoHoras: 0, seteDias: 0, custo7dUsd: 0 });
  const pega = (p: UsoProvedor) => {
    const r = assinaturaDoUso(p);
    let l = linhas.get(r);
    if (!l) linhas.set(r, (l = { rotulo: r, cincoHoras: 0, seteDias: 0, custo7dUsd: 0 }));
    return l;
  };
  for (const p of uso?.cincoHoras ?? []) pega(p).cincoHoras += p.total || 0;
  for (const p of uso?.seteDias ?? []) {
    const l = pega(p);
    l.seteDias += p.total || 0;
    l.custo7dUsd += p.custoEstimadoUsd || 0;
  }
  return [...linhas.values()];
}

/** Como está a leitura de GET /api/hermes/uso: ainda não respondeu, respondeu, 404 (fonte desligada) ou falhou. */
export type FonteUso = 'carregando' | 'ok' | 'desligada' | 'erro';

const JANELA: Record<string, string> = { cincoHoras: '5 h', seteDias: '7 dias' };

/** Monta o prédio a partir dos agentes do snapshot e do uso (ambos podem faltar). */
export function montarPredio(agentes: readonly AgentePredio[], uso: UsoHermes | null | undefined, fonte: FonteUso = uso ? 'ok' : 'carregando'): PredioVista {
  // Um crachá por personagem: o da função e um por trabalhador (vaga), todos na sala da função.
  const ocupantes = new Map<string, Ocupante>();
  const hermes = agentes
    .filter((a) => a.provider === 'hermes' && (!a.kind || a.kind === 'main'))
    .sort((a, b) => (a.hermesSlot ?? 0) - (b.hermesSlot ?? 0));
  for (const a of hermes) {
    const perfil = a.hermesProfile ?? a.name;
    if (PERSONAS.has(perfil)) continue; // persona nunca mostra cartão
    const c = a.hermes;
    const o: Ocupante = {
      perfil,
      nome: a.name !== perfil ? a.name : apelido(perfil),
      estado: c ? c.state : 'cafe',
      detalhe: c ? (c.state === 'blocked' || c.state === 'guarded' ? c.reason || c.title : c.title) : undefined,
      board: c?.board,
      agentId: a.id,
    };
    if (a.hermesModelo) o.modelo = a.hermesModelo;
    ocupantes.set(a.id, o);
  }
  const conversa = new Map((uso?.personas ?? []).map((p) => [p.perfil, p.conversando]));
  for (const perfil of PERSONAS) ocupantes.set(`persona:${perfil}`, { perfil, nome: perfil, estado: conversa.get(perfil) ? 'conversando' : 'fora' });

  const usados = new Set<string>();
  const todosOcupantes = [...ocupantes.values()];
  const andares: AndarVista[] = PLANTA.map((andar) => ({
    id: andar.id,
    titulo: andar.titulo,
    salas: andar.salas.map((s) => ({
      id: s.id,
      nome: s.nome,
      objeto: s.objeto,
      ocupantes: s.perfis.flatMap((p) => {
        usados.add(p);
        return todosOcupantes.filter((o) => o.perfil === p);
      }),
    })),
  }));
  const extras = [...ocupantes.values()].filter((o) => !usados.has(o.perfil)).sort((a, b) => a.perfil.localeCompare(b.perfil));
  const ti = andares.find((a) => a.id === 'ti')!;
  if (extras.length) ti.salas.push({ id: 'extra', nome: 'Bancada extra', ocupantes: extras });

  const todos = [...ocupantes.values()];
  const portoes = todos.filter((o) => o.estado === 'blocked').length;
  const cob = andares.find((a) => a.id === 'cobertura')!;
  cob.salas[0]!.ocupantes = [{ perfil: 'victor', nome: 'Victor', estado: portoes ? 'blocked' : 'fora', detalhe: portoes ? undefined : 'nada esperando você' }];
  if (portoes) cob.placa = `${portoes} ${portoes === 1 ? 'portão esperando' : 'portões esperando'} você`;

  const temHermes = agentes.some((a) => a.provider === 'hermes');
  const vazio = fonte === 'desligada' && !temHermes;
  let aviso: string | undefined;
  if (vazio) aviso = 'Fonte do Hermes desligada: defina HERMES_ROOT no servidor para ver o time.';
  else if (fonte === 'desligada') aviso = 'Uso por assinatura desligado no servidor (defina ESCRITORIO_USO ou HERMES_ROOT).';
  else if (fonte === 'carregando') aviso = 'Carregando o uso por assinatura…';
  else if (fonte === 'erro') aviso = 'Não consegui ler o uso agora; tento de novo em 30 s.';

  return {
    andares,
    uso: linhasUso(uso),
    cotas: (uso?.antigravity ?? []).map((c) => ({ ...c, janela: JANELA[c.janela] ?? c.janela })),
    portoes,
    trabalhando: todos.filter((o) => o.estado === 'running').length,
    vazio,
    aviso,
  };
}

/** Tokens curtos: 950 · 12,3 mil · 4,5 mi. */
export function tokensCurto(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: n < 10_000 ? 1 : 0 })} mil`;
  return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
}

/** Dados de exemplo (?mock=1): o prédio inteiro com os 4 estados, sem tocar no servidor. */
export function exemploPredio(agora = Date.now()): { agentes: AgentePredio[]; uso: UsoHermes } {
  const card = (board: string, title: string, state: EstadoCartao, reason?: string) => ({ board, taskId: `t_${title.length}`, title, state, reason });
  const modelo = (assinatura: HermesModelo['assinatura'], rotulo: string, model: string, nome: string, provider: string, extra: Partial<HermesModelo> = {}): HermesModelo => ({
    assinatura,
    rotulo,
    model,
    nome,
    provider,
    ...extra,
  });
  const agentes: AgentePredio[] = [
    { id: 'h:default', provider: 'hermes', name: 'default', hermes: card('default', 'Reconstruir o escritório após merge', 'running'), hermesModelo: modelo('claude', 'Claude', 'claude-opus-5-5', 'Claude Opus 5.5', 'anthropic') },
    { id: 'h:pl-opens', provider: 'hermes', name: 'pl-opens' },
    { id: 'h:dev', provider: 'hermes', name: 'Santos Dumont (dev)', hermesProfile: 'dev', hermesSlot: 1, hermes: card('escritorio', 'escritorio 4.4: Prédio + desfazer', 'running'), hermesModelo: modelo('agy-gemini', 'AG Gemini', 'gemini-3.1-pro', 'Gemini 3.1 Pro', 'antigravity-agy', { reserva: true, principal: 'Claude Opus 5.5', motivo: 'limite' }) },
    { id: 'h:devcodex', provider: 'hermes', name: 'devcodex', hermes: card('openfinance', 'Extrato: filtro por período', 'delivering') },
    { id: 'h:devgemini', provider: 'hermes', name: 'devgemini', hermes: card('openhealth', 'Importar exames em PDF', 'guarded', '3 falhas seguidas'), hermesModelo: modelo('agy-claude', 'AG Claude', 'claude-opus-5-5-medium', 'Claude Opus 5.5 Medium', 'antigravity-agy') },
    { id: 'h:architect', provider: 'hermes', name: 'architect', hermes: card('hermes-lab', 'Spec do painel de custos', 'blocked', 'Qual limite mensal de gasto?') },
    { id: 'h:qa', provider: 'hermes', name: 'qa' },
    { id: 'h:reviewer', provider: 'hermes', name: 'reviewer', hermes: card('openfinance', 'Revisar PR #12', 'running'), hermesModelo: modelo('codex', 'Codex', 'gpt-5.5', 'GPT-5.5', 'openai-codex') },
    { id: 'h:judge', provider: 'hermes', name: 'judge' },
    { id: 'h:auditor', provider: 'hermes', name: 'auditor' },
    { id: 'h:deployer', provider: 'hermes', name: 'deployer', hermes: card('openinfra', 'Deploy openinfra 1.3', 'running'), hermesModelo: modelo('grok', 'Grok', 'grok-4-fast-reasoning', 'Grok 4 Fast Reasoning', 'xai-oauth') },
  ];
  const p = (rotulo: string, total: number, custo = 0): UsoProvedor => ({ provedor: rotulo.toLowerCase(), rotulo, total, custoEstimadoUsd: custo });
  return {
    agentes,
    uso: {
      geradoEm: agora,
      cincoHoras: [p('Claude', 1_840_000, 7.4), p('ChatGPT', 320_000, 0.9), p('Gemini', 95_000)],
      seteDias: [p('Claude', 21_500_000, 84.2), p('ChatGPT', 4_100_000, 11.3), p('Gemini', 1_250_000, 0.4), p('Grok', 12_000, 0.02)],
      antigravity: [{ familia: 'Gemini Pro', janela: '5 h', restantePct: 62 }],
      personas: [
        { perfil: 'vini', conversando: true },
        { perfil: 'sergiao', conversando: false },
        { perfil: 'alexa', conversando: false },
      ],
    },
  };
}
