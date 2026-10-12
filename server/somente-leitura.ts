// Trava do escritório (fork do Habblaud para o time de agentes do Hermes): o servidor só observa.
//
// DESLIGADA por padrão: sem flag, as rotas de escrita do Habblaud original funcionam como antes.
// Liga só com a flag explícita ESCRITORIO_SOMENTE_LEITURA=1 (1/true/yes/sim/on):
//   - no BUILD (scripts/build-server-options.mjs): o bundle grava `true` como literal e nenhuma variável de
//     ambiente em tempo de execução religa a escrita;
//   - sem a flag no build, vale a mesma variável em tempo de execução (tsx/dev/testes e bundle padrão).
//
// Com a trava ligada, as rotas que escrevem ou abrem conteúdo das sessões respondem 404 como se não existissem:
// permissões, mensagens (e as caixas de entrada do mod/Codex), terminal, histórico de sessões, personagem,
// renomear sala, demo, eventos do Codex e qualquer outro método que não seja GET/HEAD.

declare const __ESCRITORIO_SOMENTE_LEITURA__: boolean | undefined;

/** true só com valor explícito de "ligado"; ausente, vazio ou qualquer outro valor = trava desligada. */
export function flagLigada(v: string | undefined): boolean {
  return /^(1|true|yes|sim|on)$/i.test((v ?? '').trim());
}

function fromEnv(): boolean {
  return flagLigada(process.env.ESCRITORIO_SOMENTE_LEITURA);
}

export const SOMENTE_LEITURA: boolean =
  typeof __ESCRITORIO_SOMENTE_LEITURA__ === 'boolean' ? __ESCRITORIO_SOMENTE_LEITURA__ : fromEnv();

/** Rotas de leitura que mesmo assim mostram conteúdo de sessão ou abrem terminal: somem com a trava. */
const BLOQUEADAS_MESMO_EM_GET: RegExp[] = [
  /^\/api\/agents\/[^/]+\/(terminal|character)$/,
  /^\/api\/sessions(\/|$)/,
  /^\/api\/permissions(\/|$)/,
  /^\/api\/messages(\/|$)/,
  /^\/api\/mod\/inbox(\/|$)/,
  /^\/api\/codex(\/|$)/,
];

/** true = a rota não existe no escritório somente leitura (responde 404). */
export function rotaBloqueada(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  return BLOQUEADAS_MESMO_EM_GET.some((re) => re.test(path));
}
