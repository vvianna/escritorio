// Trava do container: bind só no IP Tailscale, nenhuma montagem gravável, nenhum segredo montado.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from './fixtures';

const ROOT = resolve(__dirname, '..', '..');
const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
const semComentarios = compose
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

describe('docker-compose.yml do escritório', () => {
  it('publica a porta só no IP Tailscale 100.83.157.12', () => {
    const portas = [...semComentarios.matchAll(/^\s+- "([^"]+):4747"$/gm)].map((m) => m[1]);
    expect(portas).toEqual(['100.83.157.12:${ESCRITORIO_PORTA:-4747}']);
    expect(semComentarios).not.toMatch(/0\.0\.0\.0|127\.0\.0\.1|HABBLAUD_BIND:-/);
  });

  it('nenhuma montagem gravável: binds read-only, /data e /tmp em tmpfs, sem volume nomeado', () => {
    const binds = semComentarios.match(/- type: bind/g) ?? [];
    const ro = semComentarios.match(/read_only: true/g) ?? [];
    // +1: o read_only: true do sistema de arquivos do container.
    expect(ro.length).toBe(binds.length + 1);
    expect(semComentarios).not.toMatch(/^volumes:/m);
    expect(semComentarios).not.toMatch(/:\/data\b|habblaud-data/);
    expect(semComentarios).toMatch(/tmpfs:\n\s+- \/tmp\n\s+- \/data/);
  });

  it('não monta .env, auth.json nem config.yaml', () => {
    expect(semComentarios).not.toMatch(/\.env|auth\.json|config\.yaml/);
  });

  it('trava somente leitura desligada por padrão: só liga com ESCRITORIO_SOMENTE_LEITURA explícita no build', () => {
    expect(semComentarios).toMatch(/ESCRITORIO_SOMENTE_LEITURA: \$\{ESCRITORIO_SOMENTE_LEITURA:-\}/);
    // Escrita do Habblaud não é forçada a "0" no compose.
    expect(semComentarios).not.toMatch(/HABBLAUD_(TERMINAL|MENSAGENS|CODEX): "0"/);
  });
});

describe('tools/gerar-montagens.sh', () => {
  it('monta só kanban.db/state.db (e -wal/-shm existentes), read-only, nunca os segredos do perfil', () => {
    const tmp = tempDir();
    try {
      const h = join(tmp.dir, 'hermes');
      const arquivos = [
        'kanban.db',
        'kanban.db-wal',
        'kanban.db-shm',
        'kanban/boards/openfinance/kanban.db',
        'kanban/boards/openfinance/board.json',
        'state.db',
        '.env',
        'auth.json',
        'config.yaml',
        'profiles/dev/state.db',
        'profiles/dev/state.db-wal',
        'profiles/dev/.env',
        'profiles/dev/auth.json',
        'profiles/dev/config.yaml',
        'profiles/dev/state.db.fts_rebuild.lock',
      ];
      for (const f of arquivos) {
        mkdirSync(join(h, f, '..'), { recursive: true });
        writeFileSync(join(h, f), '');
      }
      const out = join(tmp.dir, 'override.yml');
      const msg = execFileSync('bash', [join(ROOT, 'tools/gerar-montagens.sh')], {
        env: { ...process.env, ESCRITORIO_HERMES_DIR: h, ESCRITORIO_OVERRIDE: out },
        encoding: 'utf8',
      });
      expect(msg).toContain('ok: 7 arquivos');
      const y = readFileSync(out, 'utf8');
      const targets = [...y.matchAll(/target: "([^"]+)"/g)].map((m) => m[1]).sort();
      expect(targets).toEqual(
        [
          '/hermes/kanban.db',
          '/hermes/kanban.db-shm',
          '/hermes/kanban.db-wal',
          '/hermes/kanban/boards/openfinance/kanban.db',
          '/hermes/profiles/dev/state.db',
          '/hermes/profiles/dev/state.db-wal',
          '/hermes/state.db',
        ].sort(),
      );
      expect((y.match(/read_only: true/g) ?? []).length).toBe(7);
      expect((y.match(/create_host_path: false/g) ?? []).length).toBe(7);
      const sources = [...y.matchAll(/source: "([^"]+)"/g)].map((m) => m[1]);
      expect(sources).toHaveLength(7);
      for (const s of sources) expect(s.startsWith(h + '/')).toBe(true);
      expect(sources.map((s) => s.slice(h.length)).join('\n')).not.toMatch(/\.env|auth\.json|config\.yaml|board\.json|\.lock/);
    } finally {
      tmp.cleanup();
    }
  });
});
