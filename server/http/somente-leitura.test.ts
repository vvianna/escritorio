// Trava do escritório: com a flag de build, as rotas que escrevem ou abrem conteúdo de sessão somem (404).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { serverBuildOptions } from '../../scripts/build-server-options.mjs';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { rotaBloqueada } from '../somente-leitura';
import { tempDir } from '../test/fixtures';
import { createApiHandler, sendJson, type ApiDeps } from './app';
import { Hub } from './sse';

setQuiet(true);

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

/** Servidor com TODOS os recursos de escrita ligados (como no Habblaud local); a trava é a única diferença. */
async function start(somenteLeitura: boolean): Promise<string> {
  const tmp = tempDir();
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => undefined });
  const office = new Office({
    names: new NameStore(null),
    version: '9.9.9',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: () => undefined,
  });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const ok = (_req: http.IncomingMessage, res: http.ServerResponse) => sendJson(res, 200, { ok: true });
  const deps: ApiDeps = {
    office,
    hub,
    accounts,
    sources: () => [],
    version: '9.9.9',
    inDocker: false,
    terminal: true,
    permissions: ok,
    messages: ok,
    renameRoom: () => 'sala',
    somenteLeitura,
  };
  const api = createApiHandler(deps);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!api(req, res, url)) sendJson(res, 404, { error: 'fora da api' });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  closers.push(
    () =>
      new Promise((done) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => {
          tmp.cleanup();
          done();
        });
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ESCRITA: [string, string][] = [
  ['POST', '/api/messages'],
  ['GET', '/api/messages/abc'],
  ['POST', '/api/permissions/abc/decision'],
  ['GET', '/api/permissions'],
  ['GET', '/api/mod/inbox'],
  ['POST', '/api/mod/inbox/ack'],
  ['GET', '/api/agents/.claude%3A1/terminal'],
  ['PUT', '/api/agents/.claude%3A1/character'],
  ['DELETE', '/api/agents/.claude%3A1/character'],
  ['GET', '/api/sessions/recent'],
  ['POST', '/api/codex/events'],
  ['GET', '/api/codex/bridge/poll'],
  ['POST', '/api/rooms/rename'],
  ['POST', '/api/demo'],
  ['POST', '/api/updates/check'],
];

describe('escritório somente leitura', () => {
  it('rotas de escrita e de conteúdo de sessão respondem 404', async () => {
    const base = await start(true);
    for (const [method, path] of ESCRITA) {
      const r = await fetch(base + path, { method, headers: JSON_HEADERS, body: method === 'GET' ? undefined : '{}' });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(await r.json()).toEqual({ error: 'rota desconhecida' });
    }
  });

  it('leitura continua funcionando', async () => {
    const base = await start(true);
    for (const path of ['/api/snapshot', '/api/health', '/api/updates', '/api/mod/summary']) {
      expect((await fetch(base + path)).status, path).toBe(200);
    }
  });

  it('sem a trava, as mesmas rotas existem (prova de que o 404 vem da trava)', async () => {
    const base = await start(false);
    const r = await fetch(`${base}/api/messages`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(r.status).toBe(200);
  });

  it('rotaBloqueada: qualquer método que não seja GET/HEAD', () => {
    expect(rotaBloqueada('PATCH', '/api/snapshot')).toBe(true);
    expect(rotaBloqueada('OPTIONS', '/api/health')).toBe(true);
    expect(rotaBloqueada('HEAD', '/api/snapshot')).toBe(false);
    expect(rotaBloqueada('GET', '/api/agents/x')).toBe(false);
  });
});

describe('flag de build __ESCRITORIO_SOMENTE_LEITURA__', () => {
  async function bundled(env: NodeJS.ProcessEnv): Promise<string> {
    const opts = serverBuildOptions(env);
    const out = await build({ ...opts, entryPoints: ['server/somente-leitura.ts'], outfile: 'x.js', write: false, sourcemap: false, logLevel: 'silent' });
    return out.outputFiles?.[0]?.text ?? '';
  }

  async function valorEmExecucao(code: string, envRuntime: string | undefined): Promise<boolean> {
    const antes = process.env.ESCRITORIO_SOMENTE_LEITURA;
    if (envRuntime === undefined) delete process.env.ESCRITORIO_SOMENTE_LEITURA;
    else process.env.ESCRITORIO_SOMENTE_LEITURA = envRuntime;
    try {
      // Comentário único: o mesmo código importado de novo viria do cache de módulos (mesma URL).
      const src = `${code}\n// ${Math.random()}`;
      const mod = (await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`)) as { SOMENTE_LEITURA: boolean };
      return mod.SOMENTE_LEITURA;
    } finally {
      if (antes === undefined) delete process.env.ESCRITORIO_SOMENTE_LEITURA;
      else process.env.ESCRITORIO_SOMENTE_LEITURA = antes;
    }
  }

  it('build padrão (sem flag): trava DESLIGADA, escrita como no Habblaud original', async () => {
    const code = await bundled({});
    expect(code).not.toContain('__ESCRITORIO_SOMENTE_LEITURA__');
    expect(await valorEmExecucao(code, undefined)).toBe(false);
    expect(await valorEmExecucao(code, '')).toBe(false);
    expect(await valorEmExecucao(code, '0')).toBe(false);
    // Sem flag no build, a flag explícita em execução ainda liga a trava.
    expect(await valorEmExecucao(code, '1')).toBe(true);
  });

  it('build com ESCRITORIO_SOMENTE_LEITURA=1 grava true e o ambiente em execução não religa a escrita', async () => {
    const code = await bundled({ ESCRITORIO_SOMENTE_LEITURA: '1' });
    expect(code).not.toContain('__ESCRITORIO_SOMENTE_LEITURA__');
    expect(await valorEmExecucao(code, '0')).toBe(true);
    expect(await valorEmExecucao(code, undefined)).toBe(true);
  });

  it('valores que não são "ligado" explícito não ligam a trava no build', async () => {
    for (const v of ['0', 'false', 'off', 'qualquer', ''])
      expect(await valorEmExecucao(await bundled({ ESCRITORIO_SOMENTE_LEITURA: v }), undefined)).toBe(false);
  });
});
