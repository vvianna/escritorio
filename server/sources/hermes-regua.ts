// Régua ÚNICA de "precisa do Victor?" (pedido do Victor, 12/10/2026; hermes-lab t_0fec1e29 / t_ffa7777d).
//
// Fonte de verdade: deliverables/time-de-agentes/scripts/time/regua_victor.py no hermes-lab (a mesma régua do
// kanban-nanny, do manager-voz e do manager-fila). Este arquivo é o porte, para o Escritório, das REGRAS FIXAS de lá
// (REGRAS_VICTOR e REGRA_MANAGER, aplicadas ao trecho "Você faz"). O Jev NÃO roda aqui (só nos scripts): quando
// nenhuma regra casa, a dúvida vai para o Manager, nunca para o Victor.
//
// Vai para o Victor SÓ o que cai em:
//   (2) dinheiro              gasto, assinatura, compra, cartão, chave/plano pago;
//   (3) mensagem_como_victor  mandar mensagem em nome dele;
//   (4) apagar_dado           apagar dado pessoal dele;
//   (6) so_victor_consegue    senha, login, conta nova, código 2FA, ação física.
// Todo o resto é do Manager (produção de algo já decidido, portão de produto/aprovar spec, instalar fase, reiniciar o
// gateway, reatribuir, destravar, conflito, PR, guarda active_pr). Bloqueio cujo motivo não diz "Você faz" → Manager.
//
// Quando a fila do Manager já trouxe o veredito (campo `regua` das linhas de ~/.local/state/time/manager-fila*.jsonl,
// que podem ter vindo do Jev), ele vale no lugar das regras: ver `ReguaFila` abaixo e tools/regua-fila.py, que copia
// SÓ {board, task, hash do motivo, destino, categoria, fonte, confianca} para ~/.cache/escritorio/regua.jsonl (o
// container não monta ~/.local/state/time: os motivos completos ficam no host).
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export type Destino = 'victor' | 'manager';
export type CategoriaVictor = 'dinheiro' | 'mensagem_como_victor' | 'apagar_dado' | 'so_victor_consegue';

export interface Decisao {
  destino: Destino;
  /** Uma de CategoriaVictor, "manager" (ou, vindo da fila, "relato"). */
  categoria: string;
  /** regra | sem_voce_faz | duvida (sem Jev no app) | fila:<fonte da fila> */
  fonte: string;
  confianca: number;
  porque: string;
}

/** Número de cada categoria no pedido do Victor (12/10). */
export const CATEGORIAS: Record<CategoriaVictor, number> = { dinheiro: 2, mensagem_como_victor: 3, apagar_dado: 4, so_victor_consegue: 6 };

/** Minúsculo e sem acento (o `_norm` da régua em Python). */
export function norm(t: string): string {
  return (t ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

// Regras fixas copiadas de regua_victor.py (mesma ordem; texto já normalizado).
const REGRAS_VICTOR: ReadonlyArray<readonly [CategoriaVictor, RegExp]> = [
  [
    'dinheiro',
    new RegExp(
      String.raw`\b(pagar|pagamento|gast(os?|ar)\b|assinatura|assinar o plano|plano pago|plano (pro|premium)` +
        String.raw`|comprar|compra (de|do|da)|cartao de credito|cadastrar (o |um )?cartao|cobranca|fatura` +
        String.raw`|chave paga|creditos? pagos?|upgrade (de|do) plano|r\$ ?\d|us\$ ?\d|\$ ?\d)`,
    ),
  ],
  [
    'mensagem_como_victor',
    new RegExp(
      String.raw`(em nome (do victor|dele|seu)|como se fosse (o )?victor|como o victor\b` +
        String.raw`|(pelo|no|do) seu (whatsapp|e-?mail|telegram|instagram|linkedin)` +
        String.raw`|responder .{0,40}(whatsapp|e-?mail) .{0,20}(como voce|em seu nome))`,
    ),
  ],
  [
    'apagar_dado',
    new RegExp(
      String.raw`\b(apagar|excluir|deletar|remover|limpar)\b.{0,40}\b(dados?|fotos?|e-?mails?|contas?|backups?` +
        String.raw`|historico|conversas?|documentos?|notas?|arquivos?)\b.{0,30}\b(do victor|dele|seus|suas|pessoa(l|is))`,
    ),
  ],
  [
    'so_victor_consegue',
    new RegExp(
      String.raw`\b(senha|login|logar|fazer o login|entrar na (sua )?conta|2fa|dois fatores|2 fatores` +
        String.raw`|codigo (de verificacao|por sms|do app|do autenticador)|autenticador|passkey|biometria` +
        String.raw`|conta nova|criar (uma |a )?conta|abrir (uma )?conta|captcha|presencial|fisicamente` +
        String.raw`|ir ate|ligar o cabo|tirar da tomada|apertar o botao|com o seu celular|no seu celular)`,
    ),
  ],
];
const REGRA_MANAGER = new RegExp(
  String.raw`(aprova\w* (a |o )?(spec|desenho|plano|prototipo|pr\b)|portao|\bmerge|mergea|\bpr ?#?\d+|conflit` +
    String.raw`|reatribu|reassign|unblock|desbloque|destrav|(instala|liga)\w* (a )?fase|reinicia\w* (o )?gateway` +
    String.raw`|restart|guarda|active_pr|respawn|rebase|release|\btag\b|deploy|producao|revis|review|corrig` +
    String.raw`|\bteste|\bci\b|soul\.md|cota|rate.?limit|allow once)`,
);

/** O que vem depois de "Você faz:" até "Depois disso:"/"Tempo:"/fim; undefined se o texto não tem. */
export function trechoVoceFaz(texto: string | undefined): string | undefined {
  const m = /voc[eê] faz\s*:?\s*([\s\S]*?)(?=\n\s*(?:depois disso|tempo)\s*:|$(?![\s\S]))/i.exec(texto ?? '');
  return m ? m[1].trim() : undefined;
}

/** Regras fixas: primeiro as do Victor, depois as do Manager; undefined se nenhuma casa. */
export function porRegra(texto: string): Decisao | undefined {
  const alvo = norm(trechoVoceFaz(texto) ?? texto);
  for (const [cat, rx] of REGRAS_VICTOR) {
    const m = rx.exec(alvo);
    if (m) return { destino: 'victor', categoria: cat, fonte: 'regra', confianca: 1, porque: `regra fixa: “${m[0].trim()}”` };
  }
  const m = REGRA_MANAGER.exec(alvo);
  if (m) return { destino: 'manager', categoria: 'manager', fonte: 'regra', confianca: 1, porque: `regra fixa do Manager: “${m[0].trim()}”` };
  return undefined;
}

/** `classifica` da régua sem o Jev: nenhuma regra casou → Manager (na dúvida, nunca o Victor). */
export function classifica(texto: string | undefined): Decisao {
  const t = texto ?? '';
  if (!t.trim()) return { destino: 'manager', categoria: 'manager', fonte: 'regra', confianca: 1, porque: 'texto vazio' };
  return (
    porRegra(t) ?? {
      destino: 'manager',
      categoria: 'manager',
      fonte: 'duvida',
      confianca: 0,
      porque: 'nenhuma regra fixa casou (o Jev só roda nos scripts): na dúvida, é do Manager',
    }
  );
}

/** Bloqueio de cartão: só é do Victor se diz o que ele faz E cai numa categoria dele (`decide_bloqueio`). */
export function decideBloqueio(motivo: string | undefined): Decisao {
  const txt = (motivo ?? '').replace(/\\n/g, '\n');
  if (trechoVoceFaz(txt) === undefined) {
    const r = porRegra(txt);
    const cat = r && r.destino === 'victor' ? r.categoria : 'manager';
    return {
      destino: 'manager',
      categoria: cat,
      fonte: 'sem_voce_faz',
      confianca: 1,
      porque: `o motivo não diz o que o Victor faz${cat !== 'manager' ? ` (parece ${cat})` : ''}`,
    };
  }
  return classifica(txt);
}

/** Hash do motivo como a fila grava (motivo.strip()[:3000] do kanban-nanny; corte por caractere, como em Python). */
export function hashMotivo(motivo: string | undefined): string {
  const t = Array.from((motivo ?? '').trim()).slice(0, 3000).join('');
  return createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------------------------------------- fila
/** Veredito que a fila do Manager deu para um bloqueio (linha `regua` do regua.jsonl). */
export interface VereditoFila {
  board: string;
  task: string;
  motivo: string;
  destino: Destino;
  categoria: string;
  fonte: string;
  confianca: number;
}

const BOARD_OK = /^[A-Za-z0-9._-]{1,64}$/;
const TASK_OK = /^t_[0-9a-f]{4,32}$/;
const HASH_OK = /^[0-9a-f]{16}$/;
const PALAVRA_OK = /^[a-z_:]{1,40}$/;

/** board\0task → vereditos (a última linha vale, por hash de motivo). */
export type ReguaFila = Map<string, Map<string, VereditoFila>>;

/** Lê o texto do regua.jsonl (tools/regua-fila.py); linhas estranhas e campos fora da lista são ignorados. */
export function parseReguaFila(conteudo: string): ReguaFila {
  const out: ReguaFila = new Map();
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
    if (v.tipo !== 'regua') continue;
    const { board, task, motivo, destino, categoria, fonte, confianca } = v;
    if (typeof board !== 'string' || !BOARD_OK.test(board) || typeof task !== 'string' || !TASK_OK.test(task)) continue;
    if (typeof motivo !== 'string' || !HASH_OK.test(motivo)) continue;
    if (destino !== 'victor' && destino !== 'manager') continue;
    const ver: VereditoFila = {
      board,
      task,
      motivo,
      destino,
      categoria: typeof categoria === 'string' && PALAVRA_OK.test(categoria) ? categoria : destino,
      fonte: typeof fonte === 'string' && PALAVRA_OK.test(fonte) ? fonte : '?',
      confianca: typeof confianca === 'number' && Number.isFinite(confianca) ? confianca : 0,
    };
    const k = `${board}\u0000${task}`;
    let m = out.get(k);
    if (!m) out.set(k, (m = new Map()));
    m.set(motivo, ver);
  }
  return out;
}

/** Leitor com cache por mtime do regua.jsonl; arquivo ausente/ilegível = fila vazia (aí valem as regras fixas). */
export function criarLeitorRegua(arquivo: string | null): () => ReguaFila {
  let mtime = -1;
  let cache: ReguaFila = new Map();
  return () => {
    if (!arquivo) return cache;
    try {
      const st = statSync(arquivo);
      if (st.mtimeMs === mtime) return cache;
      cache = parseReguaFila(readFileSync(arquivo, 'utf8'));
      mtime = st.mtimeMs;
    } catch {
      cache = new Map();
      mtime = -1;
    }
    return cache;
  };
}

/**
 * A régua de um bloqueio no Escritório: o veredito da fila do Manager para ESTE motivo (mesmo cartão e mesmo hash),
 * se houver; senão as regras fixas (`decideBloqueio`).
 */
export function reguaDoBloqueio(fila: ReguaFila | undefined, board: string, task: string, motivo: string | undefined): Decisao {
  const ver = fila?.get(`${board}\u0000${task}`)?.get(hashMotivo(motivo));
  if (ver) {
    return {
      destino: ver.destino,
      categoria: ver.categoria,
      fonte: `fila:${ver.fonte}`,
      confianca: ver.confianca,
      porque: `veredito da fila do Manager (${ver.fonte})`,
    };
  }
  return decideBloqueio(motivo);
}
