// Trava do container: bind só no IP Tailscale, nenhuma montagem gravável, nenhum segredo montado.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  it('monta pastas (kanban/, cache/escritorio/) e nomes.json, read-only, nunca -wal/-shm nem os segredos do perfil', () => {
    const tmp = tempDir();
    try {
      const h = join(tmp.dir, 'hermes');
      const cache = join(tmp.dir, 'cache', 'escritorio'); // não existe: o script cria
      const arquivos = [
        'kanban.db',
        'kanban.db-wal',
        'kanban.db-shm',
        'kanban/boards/openfinance/kanban.db',
        'kanban/boards/openfinance/kanban.db-wal',
        'kanban/boards/openfinance/board.json',
        'time/nomes.json',
        'state.db',
        'state.db-wal',
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
        env: { ...process.env, ESCRITORIO_HERMES_DIR: h, ESCRITORIO_CACHE_DIR: cache, ESCRITORIO_OVERRIDE: out },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(msg).toContain('ok: 4 montagens');
      expect(existsSync(cache)).toBe(true);
      const y = readFileSync(out, 'utf8');
      const pares = [...y.matchAll(/source: "([^"]+)"\n\s+target: "([^"]+)"/g)].map((m) => [m[1].replace(tmp.dir, '<tmp>'), m[2]]);
      expect(pares).toEqual([
        ['<tmp>/hermes/kanban', '/hermes/kanban'],
        ['<tmp>/hermes/kanban.db', '/hermes/kanban.db'],
        ['<tmp>/cache/escritorio', '/cache/escritorio'],
        ['<tmp>/hermes/time/nomes.json', '/hermes/time/nomes.json'],
      ]);
      expect((y.match(/read_only: true/g) ?? []).length).toBe(4);
      expect((y.match(/create_host_path: false/g) ?? []).length).toBe(4);
      const semCabecalho = y.split('\n').filter((l) => !l.startsWith('#')).join('\n').replaceAll(tmp.dir, '<tmp>');
      expect(semCabecalho).not.toMatch(/-wal|-shm|state\.db|profiles|\.env\b|auth\.json|config\.yaml|board\.json|\.lock/);
    } finally {
      tmp.cleanup();
    }
  });

  it('sem nomes.json nem kanban.db da raiz: só as pastas', () => {
    const tmp = tempDir();
    try {
      const h = join(tmp.dir, 'hermes');
      mkdirSync(join(h, 'kanban', 'boards', 'x'), { recursive: true });
      const out = join(tmp.dir, 'override.yml');
      execFileSync('bash', [join(ROOT, 'tools/gerar-montagens.sh')], {
        env: { ...process.env, ESCRITORIO_HERMES_DIR: h, ESCRITORIO_CACHE_DIR: join(tmp.dir, 'c'), ESCRITORIO_OVERRIDE: out },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const targets = [...readFileSync(out, 'utf8').matchAll(/target: "([^"]+)"/g)].map((m) => m[1]);
      expect(targets).toEqual(['/hermes/kanban', '/cache/escritorio']);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('docker-compose.yml: fonte de uso pela cópia', () => {
  it('aponta ESCRITORIO_USO e ESCRITORIO_AGY_COTA para /cache/escritorio', () => {
    expect(semComentarios).toMatch(/ESCRITORIO_USO: \/cache\/escritorio\/uso\.jsonl/);
    expect(semComentarios).toMatch(/ESCRITORIO_AGY_COTA: \/cache\/escritorio\/agy-cota\.tsv/);
  });
});
