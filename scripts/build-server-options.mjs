// Opções do esbuild para o servidor (usadas por build-server.mjs e pelo teste da trava).
//
// __ESCRITORIO_SOMENTE_LEITURA__ (server/somente-leitura.ts) vira um literal no bundle: true, salvo
// ESCRITORIO_SOMENTE_LEITURA=0 no ambiente do BUILD. Em tempo de execução nada religa as rotas de escrita.
export function serverBuildOptions(env = process.env) {
  const v = (env.ESCRITORIO_SOMENTE_LEITURA ?? '').trim();
  const somenteLeitura = !/^(0|false|no|nao|não|off)$/i.test(v);
  return {
    entryPoints: ['server/index.ts'],
    outfile: 'dist/server/index.js',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    packages: 'external',
    sourcemap: true,
    logLevel: 'info',
    define: { __ESCRITORIO_SOMENTE_LEITURA__: somenteLeitura ? 'true' : 'false' },
  };
}
