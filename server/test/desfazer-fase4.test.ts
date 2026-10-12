// tools/desfazer-fase4.sh com docker e ss falsos no PATH (nada sobe nem desce de verdade).
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../tools/desfazer-fase4.sh');
const temBash = process.platform !== 'win32' && spawnSync('bash', ['-c', 'command -v awk']).status === 0;

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** Pasta com compose + bin/ com docker e ss falsos. `teimoso` = o down não fecha a porta. */
function cenario(opts: { teimoso?: boolean; env?: string } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'desfazer4-'));
  writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}\n');
  if (opts.env !== undefined) writeFileSync(join(dir, '.env'), opts.env);
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const estado = join(dir, 'no-ar');
  writeFileSync(estado, '');
  const docker = `#!/usr/bin/env bash
echo "docker $*" >> "${dir}/log"
if [[ "$1 $2" == "compose down" ]]; then ${opts.teimoso ? ':' : `rm -f "${estado}"`}; fi
if [[ "$1 $2" == "compose ps" ]]; then [[ -f "${estado}" ]] && echo abc123; fi
exit 0
`;
  const ss = `#!/usr/bin/env bash
echo "State Recv-Q Send-Q Local Address:Port Peer Address:Port"
echo "LISTEN 0 4096 127.0.0.1:47470 0.0.0.0:*"
[[ -f "${estado}" ]] && echo "LISTEN 0 4096 100.83.157.12:\${FAKE_PORTA:-4747} 0.0.0.0:*"
exit 0
`;
  writeFileSync(join(bin, 'docker'), docker);
  writeFileSync(join(bin, 'ss'), ss);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'ss'), 0o755);
  return { bin, estado };
}

function roda(bin: string, extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ESCRITORIO_DIR: dir, PULAR_HOST: '1' };
  delete env.ESCRITORIO_PORTA;
  Object.assign(env, extra);
  const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(!temBash)('tools/desfazer-fase4.sh', () => {
  it('DRY=1 só imprime o plano (não chama compose down)', () => {
    const { bin, estado } = cenario();
    const r = roda(bin, { DRY: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('docker compose down');
    expect(r.out).toContain("':4747' → 0 (agora: 1)");
    expect(existsSync(estado)).toBe(true);
    expect(existsSync(join(dir, 'log'))).toBe(false);
  });

  it('desce o compose e confere a porta fechada', () => {
    const { bin, estado } = cenario();
    const r = roda(bin);
    expect(r.out).toContain('ok  porta 4747 fechada (ss -ltn: 0)');
    expect(r.out).toContain('DESFAZER_FASE4_OK');
    expect(r.code).toBe(0);
    expect(existsSync(estado)).toBe(false);
    expect(readFileSync(join(dir, 'log'), 'utf8')).toContain('docker compose down');
  });

  it('sai 1 se a porta continua aberta', () => {
    const { bin } = cenario({ teimoso: true });
    const r = roda(bin);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ERRO porta 4747 ainda escutando');
    expect(r.out).not.toContain('DESFAZER_FASE4_OK');
  });

  it('lê só a porta do .env (porta 47470 não conta como 4747)', () => {
    const { bin } = cenario({ env: 'SEGREDO=nao-imprime\nESCRITORIO_PORTA=4800\n' });
    const r = roda(bin, { DRY: '1', FAKE_PORTA: '4800' });
    expect(r.code).toBe(0);
    expect(r.out).toContain("':4800' → 0 (agora: 1)");
    expect(r.out).not.toContain('nao-imprime');
  });

  it('recusa rodar fora do gargantua sem PULAR_HOST', () => {
    const { bin } = cenario();
    const host = spawnSync('hostname', { encoding: 'utf8' }).stdout.trim();
    if (host === 'gargantua') return;
    const r = roda(bin, { PULAR_HOST: '0' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('rode no gargantua');
  });
});
