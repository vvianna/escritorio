// Trava do escritório (fork do Habblaud para o time de agentes do Hermes): o servidor só observa.
//
// A flag vem do BUILD: scripts/build-server.mjs troca __ESCRITORIO_SOMENTE_LEITURA__ por um literal (true, salvo
// ESCRITORIO_SOMENTE_LEITURA=0 na hora do build). No bundle, nenhuma variável de ambiente em tempo de execução
// religa as rotas de escrita. Sem build (tsx/dev/testes) vale ESCRITORIO_SOMENTE_LEITURA, ligada por padrão.
//
// Com a trava, as rotas que escrevem ou abrem conteúdo das sessões respondem 404 como se não existissem:
// permissões, mensagens (e as caixas de entrada do mod/Codex), terminal, histórico de sessões, personagem,
// renomear sala, demo, eventos do Codex e qualquer outro método que não seja GET/HEAD.

declare const __ESCRITORIO_SOMENTE_LEITURA__: boolean | undefined;

function fromEnv(): boolean {
  const v = process.env.ESCRITORIO_SOMENTE_LEITURA?.trim();
  return !(v && /^(0|false|no|nao|não|off)$/i.test(v));
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
