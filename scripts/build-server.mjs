// Empacota o servidor (TypeScript) em um único arquivo ESM em dist/server.
import { build } from 'esbuild';
import { serverBuildOptions } from './build-server-options.mjs';

// Inclui a flag de build __ESCRITORIO_SOMENTE_LEITURA__ (ver build-server-options.mjs).
await build(serverBuildOptions());
