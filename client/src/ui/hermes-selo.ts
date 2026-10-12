// Selo de provedor/modelo da cadeira de um trabalhador do Hermes (AgentInfo.hermesModelo, sources/hermes-cadeira.ts).
// Puro (sem DOM): testado em ui/hermes-selo.test.ts. Cor por assinatura (Claude, Codex, Antigravity Gemini,
// Antigravity Claude, Grok); laranja com "↪ reserva" quando a cadeira caiu para a reserva no meio do cartão.
import type { HermesModelo } from '../../../shared/types';

/** Cópia do host mais velha que isto: o hover avisa que o dado pode estar atrasado. */
export const SELO_VELHO_MS = 10 * 60_000;

export interface Selo {
  texto: string;
  /** Cor do selo (classe `ui-hsel--<variante>`): a assinatura, ou `reserva` (laranja). */
  variante: string;
  /** Hover: nome do modelo, provedor e, na reserva, o principal e o motivo. */
  titulo: string;
}

const NOME_ASSINATURA: Record<HermesModelo['assinatura'], string> = {
  claude: 'assinatura Claude',
  codex: 'assinatura ChatGPT (Codex)',
  'agy-gemini': 'Antigravity (Gemini)',
  'agy-claude': 'Antigravity (Claude)',
  grok: 'assinatura Grok',
  outro: 'outro provedor',
};

function hora(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function seloModelo(m: HermesModelo, agora = Date.now()): Selo {
  const partes = [`${m.nome} · ${m.provider || '?'} (${NOME_ASSINATURA[m.assinatura] ?? m.rotulo})`];
  if (m.reserva) {
    partes.push(`↪ na reserva${m.principal ? ` (principal: ${m.principal})` : ''}${m.motivo ? ` — motivo: ${m.motivo}` : ''}`);
  }
  if (m.em) partes.push(`última chamada às ${hora(m.em)}`);
  if (m.copiadoEm && agora - m.copiadoEm > SELO_VELHO_MS) partes.push(`⚠ dado de ${Math.round((agora - m.copiadoEm) / 60_000)} min atrás (cópia do host parada?)`);
  return {
    texto: m.reserva ? '↪ reserva' : m.rotulo,
    variante: m.reserva ? 'reserva' : m.assinatura,
    titulo: partes.join('\n'),
  };
}
