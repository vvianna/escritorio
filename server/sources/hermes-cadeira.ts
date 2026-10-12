// Provedor/modelo AO VIVO de cada cadeira do Hermes (trabalhador com cartão running) e a configuração de cada perfil.
//
// No container a pasta profiles/ do Hermes não entra: tools/copiar-uso.sh (host, cron de 2 em 2 min) grava
// ~/.cache/escritorio/cadeiras.jsonl só com metadado (formato no cabeçalho da seção "Cadeiras" do script):
//   - chamada: última chamada de cada sessão nas últimas 6 h do logs/agent.log do perfil (modelo, provedor, hora, o
//     id do cartão do worker e, se houve, a troca para a reserva com o motivo);
//   - sessao: sessões kanban das últimas 24 h do state.db (id, modelo, provedor, início) — para casar pelo horário
//     quando o log não diz o cartão;
//   - config: model.default/model.provider e fallback_providers do perfil (nenhuma outra chave).
// Aqui só se lê esse arquivo; nada de conteúdo de conversa.
import { readFileSync, statSync } from 'node:fs';
import { hash32 } from '../../shared/hash';
import type { HermesAssinatura, HermesModelo } from '../../shared/types';

/** Cópia mais velha que isto (cron parado) não muda mais a cadeira: o selo fica com o último dado e avisa no hover. */
export const CADEIRA_VELHA_MS = 10 * 60_000;
/** Sessão kanban casa com o cartão se começou até isto depois do início do run (o worker sobe em segundos). */
export const CASAMENTO_S = 180;

export interface Chamada {
  perfil: string;
  sessao: string;
  /** Cartão que o worker recebeu ("work kanban task t_..."), '' quando o log não diz. */
  tarefa: string;
  model: string;
  provider: string;
  /** Epoch s da última chamada. */
  em: number;
  chamadas: number;
  reservaDe?: string;
  reservaPara?: string;
  reservaProvider?: string;
  reservaMotivo?: string;
  reservaEm?: number;
}

export interface SessaoKanban {
  perfil: string;
  sessao: string;
  model: string;
  provider: string;
  /** Epoch s. */
  startedAt: number;
}

export interface ConfigPerfil {
  perfil: string;
  model: string;
  provider: string;
  /** "provedor/modelo" na ordem do config. */
  fallback: string[];
  /** Resumo estável do que importa (model/provider/fallback): muda quando alguém troca a configuração. */
  hash: string;
}

export interface DadosCadeiras {
  /** Epoch ms da geração no host. */
  copiadoEm?: number;
  chamadas: Chamada[];
  sessoes: SessaoKanban[];
  configs: Map<string, ConfigPerfil>;
}

const NOME_OK = /^[A-Za-z0-9._-]+$/;
const VALOR_OK = /^[A-Za-z0-9._:/@-]*$/;
const SESSAO_OK = /^[A-Za-z0-9_]+$/;
const TAREFA_OK = /^t_[0-9a-f]+$/;
const MOTIVOS = new Set(['limite', 'créditos', 'demora', 'erro', 'desconhecido']);

function texto(v: unknown): string {
  return typeof v === 'string' && VALOR_OK.test(v) ? v : '';
}

function numero(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function vazio(): DadosCadeiras {
  return { chamadas: [], sessoes: [], configs: new Map() };
}

/** Hash da configuração (model, provider e fallback, nessa ordem). */
export function hashConfig(model: string, provider: string, fallback: readonly string[]): string {
  return hash32(JSON.stringify([model, provider, fallback])).toString(16);
}

/** Lê o texto do cadeiras.jsonl; linhas estranhas e campos fora da lista são ignorados. */
export function parseCadeiras(conteudo: string): DadosCadeiras {
  const out = vazio();
  for (const bruta of conteudo.split('\n')) {
    if (!bruta.trim()) continue;
    let v: Record<string, unknown>;
    try {
      const j = JSON.parse(bruta) as unknown;
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
      v = j as Record<string, unknown>;
    } catch {
      continue;
    }
    if (v.tipo === 'meta') {
      const g = numero(v.gerado_em);
      if (g) out.copiadoEm = Math.round(g * 1000);
      continue;
    }
    const perfil = typeof v.perfil === 'string' && NOME_OK.test(v.perfil) ? v.perfil : undefined;
    if (!perfil) continue;
    if (v.tipo === 'chamada') {
      const sessao = typeof v.sessao === 'string' && SESSAO_OK.test(v.sessao) ? v.sessao : undefined;
      const model = texto(v.model);
      const em = numero(v.em);
      if (!sessao || !model || !em) continue;
      const c: Chamada = {
        perfil,
        sessao,
        tarefa: typeof v.tarefa === 'string' && TAREFA_OK.test(v.tarefa) ? v.tarefa : '',
        model,
        provider: texto(v.provider),
        em,
        chamadas: numero(v.chamadas) ?? 0,
      };
      const re = numero(v.reserva_em);
      if (re) {
        c.reservaEm = re;
        c.reservaDe = texto(v.reserva_de);
        c.reservaPara = texto(v.reserva_para);
        c.reservaProvider = texto(v.reserva_provider);
        c.reservaMotivo = typeof v.reserva_motivo === 'string' && MOTIVOS.has(v.reserva_motivo) ? v.reserva_motivo : 'desconhecido';
      }
      out.chamadas.push(c);
    } else if (v.tipo === 'sessao') {
      const sessao = typeof v.sessao === 'string' && SESSAO_OK.test(v.sessao) ? v.sessao : undefined;
      const startedAt = numero(v.started_at);
      if (!sessao || !startedAt) continue;
      out.sessoes.push({ perfil, sessao, model: texto(v.model), provider: texto(v.billing_provider), startedAt });
    } else if (v.tipo === 'config') {
      const model = texto(v.model);
      const provider = texto(v.provider);
      const fallback = Array.isArray(v.fallback) ? v.fallback.filter((f): f is string => typeof f === 'string' && VALOR_OK.test(f) && f !== '/') : [];
      out.configs.set(perfil, { perfil, model, provider, fallback, hash: hashConfig(model, provider, fallback) });
    }
  }
  return out;
}

/** Leitor com cache pelo mtime (a fonte relê a cada ciclo de 5 s; o arquivo muda de 2 em 2 min). */
export function criarLeitorCadeiras(arquivo: string | null | undefined): () => DadosCadeiras {
  let mtime = -1;
  let ultimo = vazio();
  return () => {
    if (!arquivo) return ultimo;
    let m: number;
    try {
      m = statSync(arquivo).mtimeMs;
    } catch {
      mtime = -1;
      ultimo = vazio();
      return ultimo;
    }
    if (m === mtime) return ultimo;
    try {
      ultimo = parseCadeiras(readFileSync(arquivo, 'utf8'));
      mtime = m;
    } catch {
      // meio arquivo ou ilegível: fica com o último e tenta de novo no próximo ciclo
    }
    return ultimo;
  };
}

/** Assinatura (cor do selo) de uma chamada: pelo provedor e, no Antigravity, pela família do modelo. */
export function assinaturaDe(provider: string, model: string): { assinatura: HermesAssinatura; rotulo: string } {
  const p = provider.toLowerCase();
  const m = model.toLowerCase();
  if (p.startsWith('antigravity') || p.startsWith('agy')) {
    if (m.startsWith('claude')) return { assinatura: 'agy-claude', rotulo: 'AG Claude' };
    return { assinatura: 'agy-gemini', rotulo: 'AG Gemini' };
  }
  if (p.startsWith('anthropic') || p.startsWith('claude')) return { assinatura: 'claude', rotulo: 'Claude' };
  if (p.startsWith('openai') || p.startsWith('codex') || p.startsWith('chatgpt')) return { assinatura: 'codex', rotulo: 'Codex' };
  if (p.startsWith('xai') || p.startsWith('grok')) return { assinatura: 'grok', rotulo: 'Grok' };
  if (!p && m.startsWith('claude')) return { assinatura: 'claude', rotulo: 'Claude' };
  return { assinatura: 'outro', rotulo: provider || 'Outro' };
}

const SIGLAS: Record<string, string> = { gpt: 'GPT', ai: 'AI', llm: 'LLM' };

/** Nome legível do modelo: "claude-opus-5-5" -> "Claude Opus 5.5", "gpt-5.5" -> "GPT-5.5", "gemini-3.1-pro" -> "Gemini 3.1 Pro". */
export function nomeModelo(model: string): string {
  const id = model.replace(/^.*\//, '');
  if (!id) return model;
  const gpt = /^gpt-(.+)$/i.exec(id);
  if (gpt) return `GPT-${gpt[1]!.split('-').map((p, i) => (i === 0 ? p : cap(p))).join(' ')}`;
  const partes = id.split('-').filter(Boolean);
  const saida: string[] = [];
  for (const p of partes) {
    const ant = saida[saida.length - 1];
    // números seguidos viram versão: claude-opus-5-5 -> 5.5
    if (/^\d+$/.test(p) && ant !== undefined && /^\d+(\.\d+)*$/.test(ant)) saida[saida.length - 1] = `${ant}.${p}`;
    else saida.push(/^\d/.test(p) ? p : (SIGLAS[p.toLowerCase()] ?? cap(p)));
  }
  return saida.join(' ');
}

function cap(p: string): string {
  return p ? p[0]!.toUpperCase() + p.slice(1) : p;
}

/**
 * A sessão do worker de um cartão: primeiro pela linha "work kanban task <id>" do log (sessão mais recente que começou
 * neste run), senão pela sessão kanban do perfil que começou logo depois do run (até CASAMENTO_S).
 * `runInicio` = epoch s do início do run atual (task_runs.started_at).
 */
export function chamadaDoCartao(dados: DadosCadeiras, perfil: string, tarefa: string, runInicio: number | undefined): { chamada?: Chamada; sessao?: SessaoKanban } {
  const desde = runInicio !== undefined ? runInicio - 60 : 0;
  let melhor: Chamada | undefined;
  for (const c of dados.chamadas) {
    if (c.perfil !== perfil || c.tarefa !== tarefa || c.em < desde) continue;
    if (!melhor || c.em > melhor.em) melhor = c;
  }
  if (melhor) return { chamada: melhor };
  if (runInicio === undefined) return {};
  let sessao: SessaoKanban | undefined;
  for (const s of dados.sessoes) {
    if (s.perfil !== perfil) continue;
    const d = s.startedAt - runInicio;
    if (d < -10 || d > CASAMENTO_S) continue;
    if (!sessao || Math.abs(d) < Math.abs(sessao.startedAt - runInicio)) sessao = s;
  }
  if (!sessao) return {};
  const chamada = dados.chamadas.find((c) => c.perfil === perfil && c.sessao === sessao!.sessao);
  return chamada ? { chamada, sessao } : { sessao };
}

/** O que a cadeira mostra para este cartão (undefined = sem dado). */
export function modeloDaCadeira(dados: DadosCadeiras, perfil: string, tarefa: string, runInicio: number | undefined): HermesModelo | undefined {
  const { chamada, sessao } = chamadaDoCartao(dados, perfil, tarefa, runInicio);
  const model = chamada?.model ?? sessao?.model ?? '';
  const provider = chamada?.provider ?? sessao?.provider ?? '';
  if (!model) return undefined;
  const out: HermesModelo = { ...assinaturaDe(provider, model), model, nome: nomeModelo(model), provider };
  if (chamada) out.em = chamada.em * 1000;
  if (dados.copiadoEm) out.copiadoEm = dados.copiadoEm;
  const cfg = dados.configs.get(perfil);
  const trocou = !!chamada?.reservaEm && chamada.reservaPara === model;
  const foraDoPrincipal = !!cfg?.provider && !!provider && cfg.provider !== provider;
  if (trocou || foraDoPrincipal) {
    out.reserva = true;
    const principal = cfg?.model || chamada?.reservaDe;
    if (principal && principal !== model) out.principal = nomeModelo(principal);
    if (trocou && chamada?.reservaMotivo) out.motivo = chamada.reservaMotivo;
  }
  return out;
}
