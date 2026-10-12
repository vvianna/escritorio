import { describe, expect, it } from 'vitest';
import type { HermesModelo } from '../../../shared/types';
import { seloModelo } from './hermes-selo';

const AGORA = Date.UTC(2026, 9, 11, 23, 0, 0);
const base: HermesModelo = { assinatura: 'claude', rotulo: 'Claude', model: 'claude-opus-5-5', nome: 'Claude Opus 5.5', provider: 'anthropic' };

describe('selo de modelo da cadeira', () => {
  it('assinatura no selo, modelo no hover', () => {
    const s = seloModelo(base, AGORA);
    expect(s).toMatchObject({ texto: 'Claude', variante: 'claude' });
    expect(s.titulo).toBe('Claude Opus 5.5 · anthropic (assinatura Claude)');
    expect(seloModelo({ ...base, assinatura: 'agy-gemini', rotulo: 'AG Gemini', nome: 'Gemini 3.1 Pro', provider: 'antigravity-agy' }, AGORA)).toMatchObject({
      texto: 'AG Gemini',
      variante: 'agy-gemini',
      titulo: 'Gemini 3.1 Pro · antigravity-agy (Antigravity (Gemini))',
    });
  });

  it('reserva: laranja com "↪ reserva", principal e motivo no hover', () => {
    const s = seloModelo({ ...base, assinatura: 'codex', rotulo: 'Codex', nome: 'GPT-5.5', provider: 'openai-codex', reserva: true, principal: 'Claude Opus 5.5', motivo: 'limite' }, AGORA);
    expect(s.texto).toBe('↪ reserva');
    expect(s.variante).toBe('reserva');
    expect(s.titulo).toContain('GPT-5.5 · openai-codex');
    expect(s.titulo).toContain('↪ na reserva (principal: Claude Opus 5.5) — motivo: limite');
  });

  it('cópia do host velha avisa no hover', () => {
    expect(seloModelo({ ...base, copiadoEm: AGORA - 30 * 60_000 }, AGORA).titulo).toMatch(/dado de 30 min atrás/);
    expect(seloModelo({ ...base, copiadoEm: AGORA - 60_000 }, AGORA).titulo).not.toMatch(/min atrás/);
  });
});
