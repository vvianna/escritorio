import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { classifica, criarLeitorRegua, decideBloqueio, hashMotivo, parseReguaFila, porRegra, reguaDoBloqueio, trechoVoceFaz } from './hermes-regua';

/** Motivo no formato de 01/10 ("O que travou / Você faz / Depois disso / Tempo"). */
const motivo = (voceFaz: string, travou = 'o cartão parou.') => `O que travou: ${travou}\nVocê faz: ${voceFaz}\nDepois disso: o agente segue.\nTempo: ~2 min.`;

describe('régua única "precisa do Victor?" (porte das regras fixas de regua_victor.py)', () => {
  it('trecho "Você faz": até "Depois disso"/"Tempo" ou o fim; undefined sem ele', () => {
    expect(trechoVoceFaz(motivo('aprove o PR #3.'))).toBe('aprove o PR #3.');
    expect(trechoVoceFaz('O que travou: x\nVOCÊ FAZ: toque em Allow Once')).toBe('toque em Allow Once');
    expect(trechoVoceFaz('O que travou: falta a senha')).toBeUndefined();
  });

  it.each([
    ['(2) dinheiro', 'assine o plano Pro de R$ 99 e cadastre o cartão.', 'dinheiro'],
    ['(3) mensagem como o Victor', 'responda o fornecedor pelo seu WhatsApp, em nome do Victor.', 'mensagem_como_victor'],
    ['(4) apagar dado dele', 'apagar as fotos antigas do Victor no Drive.', 'apagar_dado'],
    ['(6) só ele consegue', 'entre na sua conta do banco e digite o código do autenticador.', 'so_victor_consegue'],
  ])('%s → Victor', (_nome, voceFaz, cat) => {
    expect(decideBloqueio(motivo(voceFaz))).toMatchObject({ destino: 'victor', categoria: cat, fonte: 'regra' });
  });

  it.each([
    ['instalar fase', 'rode bash install-fase5.sh para instalar a fase 5.'],
    ['reiniciar gateway', 'reinicie o gateway (systemctl --user restart hermes-gateway).'],
    ['portão de produto', 'aprove a spec do portão de produto e responda "sim".'],
    ['guarda active_pr', 'solte a guarda active_pr do cartão.'],
    ['reatribuir', 'reatribua o cartão ao dev.'],
  ])('Manager: %s', (_nome, voceFaz) => {
    expect(decideBloqueio(motivo(voceFaz))).toMatchObject({ destino: 'manager', categoria: 'manager', fonte: 'regra' });
  });

  it('sem "Você faz" → Manager, mesmo que pareça do Victor', () => {
    expect(decideBloqueio('O que travou: preciso que você escolha a cor.')).toMatchObject({ destino: 'manager', fonte: 'sem_voce_faz', categoria: 'manager' });
    expect(decideBloqueio('O que travou: falta a senha do banco.')).toMatchObject({ destino: 'manager', fonte: 'sem_voce_faz', categoria: 'so_victor_consegue' });
    expect(decideBloqueio(undefined)).toMatchObject({ destino: 'manager', fonte: 'sem_voce_faz' });
  });

  it('o "O que travou" não conta quando há "Você faz" (login citado num teste não é pedido)', () => {
    expect(decideBloqueio(motivo('reatribua ao dev.', 'o teste de login quebrou.'))).toMatchObject({ destino: 'manager' });
  });

  it('nenhuma regra casa: na dúvida é do Manager (o Jev só roda nos scripts)', () => {
    expect(decideBloqueio(motivo('escolha entre azul e verde.'))).toMatchObject({ destino: 'manager', fonte: 'duvida', confianca: 0 });
    expect(classifica('   ')).toMatchObject({ destino: 'manager', porque: 'texto vazio' });
  });

  it('as do Victor vêm antes das do Manager (como em Python)', () => {
    expect(porRegra('Você faz: pague a fatura e depois faça o merge do PR #4')).toMatchObject({ destino: 'victor', categoria: 'dinheiro' });
  });

  it('\\n literal do payload vira quebra de linha', () => {
    expect(decideBloqueio('O que travou: x\\nVocê faz: digite a senha\\nTempo: 1 min')).toMatchObject({ destino: 'victor', categoria: 'so_victor_consegue' });
  });
});

describe('veredito da fila do Manager (regua.jsonl)', () => {
  const m1 = motivo('escolha entre azul e verde.');
  const linha = (o: Record<string, unknown>) => JSON.stringify({ tipo: 'regua', board: 'hermes-lab', task: 't_abc123', motivo: hashMotivo(m1), destino: 'victor', categoria: 'dinheiro', fonte: 'jev', confianca: 0.9, ...o });

  it('vale o veredito da fila para o MESMO motivo; outro motivo cai nas regras fixas', () => {
    const fila = parseReguaFila([linha({ destino: 'manager', fonte: 'regra' }), linha({}), '{"tipo":"meta"}', 'lixo', ''].join('\n'));
    expect(reguaDoBloqueio(fila, 'hermes-lab', 't_abc123', m1)).toMatchObject({ destino: 'victor', categoria: 'dinheiro', fonte: 'fila:jev' });
    expect(reguaDoBloqueio(fila, 'hermes-lab', 't_abc123', `  ${m1}\n`)).toMatchObject({ fonte: 'fila:jev' });
    expect(reguaDoBloqueio(fila, 'hermes-lab', 't_abc123', motivo('outra coisa.'))).toMatchObject({ destino: 'manager', fonte: 'duvida' });
    expect(reguaDoBloqueio(fila, 'openhealth', 't_abc123', m1)).toMatchObject({ destino: 'manager', fonte: 'duvida' });
  });

  it('linhas estranhas são descartadas', () => {
    const fila = parseReguaFila(
      [linha({ destino: 'talvez' }), linha({ task: '../etc' }), linha({ board: 'a b' }), linha({ motivo: 'texto do motivo inteiro' })].join('\n'),
    );
    expect(fila.size).toBe(0);
  });

  it('leitor: arquivo ausente = fila vazia; relê quando muda', () => {
    const t = tempDir('regua-');
    try {
      const arq = join(t.dir, 'regua.jsonl');
      const ler = criarLeitorRegua(arq);
      expect(ler().size).toBe(0);
      writeFileSync(arq, `${linha({})}\n`);
      expect(ler().size).toBe(1);
      expect(criarLeitorRegua(null)().size).toBe(0);
    } finally {
      t.cleanup();
    }
  });
});

describe('tools/regua-fila.py (host → regua.jsonl, só metadado)', () => {
  const SCRIPT = resolve(__dirname, '..', '..', 'tools', 'regua-fila.py');
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    const t = tempDir('regua-fila-');
    dir = t.dir;
    cleanup = t.cleanup;
  });
  afterEach(() => cleanup());

  it('copia só board, cartão, hash do motivo e o veredito; o hash bate com o do Escritório', () => {
    const fila = join(dir, 'time');
    mkdirSync(fila);
    const segredo = 'O que travou: x\nVocê faz: digite a senha SEGREDO-123 em ~/caminho/pessoal 😀';
    const item = (task: string, destino: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ board: 'hermes-lab', task, titulo: 'TITULO-PRIVADO', assignee: 'dev', motivo: segredo, origem: 'nanny-bloqueio', regua: { destino, categoria: 'so_victor_consegue', fonte: 'regra', confianca: 1, porque: 'PORQUE-PRIVADO' }, ...extra });
    writeFileSync(join(fila, 'manager-fila.feitos.jsonl'), `${item('t_aaaa11', 'manager')}\n{"board":"x","task":"t_bbbb22","motivo":"sem régua"}\nlixo\n`);
    writeFileSync(join(fila, 'manager-fila.jsonl'), `${item('t_aaaa11', 'victor')}\n`);
    const saida = join(dir, 'cache', 'regua.jsonl');
    execFileSync('python3', [SCRIPT, fila, saida], { env: { ...process.env, ESCRITORIO_AGORA: '1791800000' } });
    const texto = readFileSync(saida, 'utf8');
    for (const p of ['SEGREDO', 'TITULO', 'PORQUE', 'caminho', 'dev', 'nanny']) expect(texto).not.toContain(p);
    const linhas = texto.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(linhas[0]).toEqual({ tipo: 'meta', gerado_em: 1791800000, versao: 1 });
    expect(linhas.slice(1).map((l) => Object.keys(l).sort())).toEqual(Array(2).fill(['board', 'categoria', 'confianca', 'destino', 'fonte', 'motivo', 'task', 'tipo']));
    // a fila (mais nova) vem por último e vence no Escritório
    const lida = parseReguaFila(texto);
    expect(reguaDoBloqueio(lida, 'hermes-lab', 't_aaaa11', segredo)).toMatchObject({ destino: 'victor', fonte: 'fila:regra' });
  });
});
