import type { BuildOptions } from 'esbuild';

export function serverBuildOptions(env?: NodeJS.ProcessEnv): BuildOptions & { define: Record<string, string> };
