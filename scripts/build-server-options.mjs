// Opções do esbuild para o servidor (usadas por build-server.mjs e pelo teste da trava).
//
// Trava somente leitura (server/somente-leitura.ts) DESLIGADA por padrão. Com ESCRITORIO_SOMENTE_LEITURA=1
// (1/true/yes/sim/on) no ambiente do BUILD, __ESCRITORIO_SOMENTE_LEITURA__ vira o literal `true` no bundle e nada em
// tempo de execução religa as rotas de escrita. Sem a flag, vira `undefined` e vale o ambiente em execução
// (padrão: desligada, rotas de escrita do Habblaud como antes).
export function serverBuildOptions(env = process.env) {
  const somenteLeitura = /^(1|true|yes|sim|on)$/i.test((env.ESCRITORIO_SOMENTE_LEITURA ?? '').trim());
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
    define: { __ESCRITORIO_SOMENTE_LEITURA__: somenteLeitura ? 'true' : 'undefined' },
  };
}
