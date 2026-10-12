import usoReal from './fixtures/hermes-uso.json';
import { describe, expect, it } from 'vitest';
import { exemploPredio, linhaCotas, linhasUso, montarPredio, salaDe, tokensCurto, type AgentePredio, type UsoHermes } from './predio-model';

const andarDe = (v: ReturnType<typeof montarPredio>, perfil: string) =>
  v.andares.find((a) => a.salas.some((s) => s.ocupantes.some((o) => o.perfil === perfil)))?.id;
const ocupante = (v: ReturnType<typeof montarPredio>, perfil: string) =>
  v.andares.flatMap((a) => a.salas.flatMap((s) => s.ocupantes)).find((o) => o.perfil === perfil);

describe('prédio', () => {
  it('põe cada perfil no andar do escritorio.md', () => {
    expect(salaDe('produto')).toEqual({ andar: 'produto', sala: 'produto' });
    expect(salaDe('dev')).toEqual({ andar: 'ti', sala: 'devs' });
    expect(salaDe('judge')).toEqual({ andar: 'ti', sala: 'seguranca' });
    expect(salaDe('vini')).toEqual({ andar: 'terreo', sala: 'recepcao' });
    expect(salaDe('novo-perfil')).toEqual({ andar: 'ti', sala: 'extra' });
  });

  it('mostra os 4 estados, café e a placa da cobertura', () => {
    const { agentes, uso } = exemploPredio(0);
    const v = montarPredio(agentes, uso);
    expect(v.andares.map((a) => a.id)).toEqual(['cobertura', 'produto', 'ti', 'terreo']);
    expect(ocupante(v, 'dev')?.estado).toBe('running');
    expect(ocupante(v, 'architect')).toMatchObject({ estado: 'blocked', detalhe: 'Qual limite mensal de gasto?' });
    expect(ocupante(v, 'devgemini')?.estado).toBe('guarded');
    expect(ocupante(v, 'devcodex')?.estado).toBe('delivering');
    expect(ocupante(v, 'qa')?.estado).toBe('cafe');
    expect(ocupante(v, 'default')?.nome).toBe('Manager');
    expect(v.portoes).toBe(1);
    expect(v.andares[0]!.placa).toBe('1 portão esperando você');
    expect(ocupante(v, 'vini')?.estado).toBe('conversando');
    expect(ocupante(v, 'alexa')?.estado).toBe('fora');
  });

  it('persona nunca mostra cartão nem título', () => {
    const agentes: AgentePredio[] = [{ id: 'x', provider: 'hermes', name: 'sergiao', hermes: { board: 'b', taskId: 't', title: 'segredo', state: 'running' } }];
    const v = montarPredio(agentes, null);
    expect(andarDe(v, 'sergiao')).toBe('terreo');
    expect(JSON.stringify(v)).not.toContain('segredo');
  });

  it('ignora agentes que não são do Hermes e põe perfil desconhecido na bancada extra', () => {
    const agentes: AgentePredio[] = [
      { id: 'c', provider: 'claude', name: 'Ana' },
      { id: 'h', provider: 'hermes', name: 'pl-xyz' },
    ];
    const v = montarPredio(agentes, null);
    expect(ocupante(v, 'Ana')).toBeUndefined();
    const ti = v.andares.find((a) => a.id === 'ti')!;
    expect(ti.salas.at(-1)).toMatchObject({ id: 'extra', ocupantes: [{ perfil: 'pl-xyz', estado: 'cafe' }] });
    expect(v.vazio).toBe(false);
    expect(montarPredio([], null, 'desligada').vazio).toBe(true);
  });

  it('um crachá por trabalhador, com o nome da vaga, na sala da função', () => {
    const card = (t: string) => ({ board: 'escritorio', taskId: t, title: `cartão ${t}`, state: 'running' as const });
    const agentes: AgentePredio[] = [
      { id: 'hermes:dev', provider: 'hermes', name: 'dev', hermesProfile: 'dev', hermes: { ...card('t_b'), state: 'blocked', reason: 'precisa' } },
      { id: 'hermes:dev:escritorio:t_2', provider: 'hermes', name: 'dev #2', hermesProfile: 'dev', hermesSlot: 2, hermes: card('t_2') },
      { id: 'hermes:dev:escritorio:t_1', provider: 'hermes', name: 'Oswaldo Cruz (dev)', hermesProfile: 'dev', hermesSlot: 1, hermes: card('t_1') },
      { id: 'hermes:default', provider: 'hermes', name: 'Hermes (default)', hermesProfile: 'default' },
    ];
    const v = montarPredio(agentes, null);
    const devs = v.andares.find((a) => a.id === 'ti')!.salas.find((s) => s.id === 'devs')!;
    expect(devs.ocupantes.map((o) => o.nome)).toEqual(['dev', 'Oswaldo Cruz (dev)', 'dev #2']);
    expect(v.trabalhando).toBe(2);
    expect(v.portoes).toBe(1);
    expect(ocupante(v, 'default')?.nome).toBe('Hermes (default)');
    expect(v.andares.find((a) => a.id === 'ti')!.salas.some((s) => s.id === 'extra')).toBe(false);
  });

  it('painel de uso: as 4 assinaturas sempre, somando por rótulo', () => {
    const l = linhasUso({
      geradoEm: 0,
      cincoHoras: [{ provedor: 'anthropic', rotulo: 'Claude', total: 10, custoEstimadoUsd: 1 }],
      seteDias: [
        { provedor: 'anthropic', rotulo: 'Claude', total: 100, custoEstimadoUsd: 2 },
        { provedor: 'claude', rotulo: 'Claude', total: 50, custoEstimadoUsd: 0.5 },
        { provedor: 'nous', rotulo: 'nous', total: 7, custoEstimadoUsd: 0 },
      ],
      personas: [],
    });
    expect(l.map((x) => x.rotulo)).toEqual(['Claude', 'ChatGPT', 'Antigravity (Gemini)', 'Grok', 'nous']);
    expect(l[0]).toEqual({ rotulo: 'Claude', cincoHoras: 10, seteDias: 150, custo7dUsd: 2.5 });
    expect(linhasUso(null).every((x) => x.seteDias === 0)).toBe(true);
  });

  it('JSON real do /api/hermes/uso: cada provedor cai na sua assinatura', () => {
    const uso = usoReal as UsoHermes;
    const l = Object.fromEntries(linhasUso(uso).map((x) => [x.rotulo, x]));
    expect(Object.keys(l)).toEqual(['Claude', 'ChatGPT', 'Antigravity (Gemini)', 'Grok', 'Desconhecido']);
    expect(l.Claude!.seteDias).toBe(15_655_190 + 596); // anthropic + fallback_chain[0](anthropic)
    expect(l.Claude!.cincoHoras).toBe(375_193);
    expect(l.ChatGPT!.seteDias).toBe(6_499_737 + 677_392); // openai-codex + openai-api
    expect(l['Antigravity (Gemini)']!.seteDias).toBe(8_692_711); // antigravity-agy
    expect(l.Grok!.seteDias).toBe(26_472_900); // xai-oauth
  });

  it('aviso: fonte desligada só com 404; carregando e "ninguém trabalhando" não são fonte desligada', () => {
    const uso = usoReal as UsoHermes;
    const ocioso: AgentePredio[] = [{ id: 'hermes:qa', provider: 'hermes', name: 'qa' }];
    const ok = montarPredio(ocioso, uso, 'ok');
    expect(ok.trabalhando).toBe(0);
    expect(ok.vazio).toBe(false);
    expect(ok.aviso).toBeUndefined();
    const carregando = montarPredio([], null, 'carregando');
    expect(carregando.vazio).toBe(false);
    expect(carregando.aviso).toMatch(/carregando/i);
    expect(montarPredio(ocioso, uso, 'erro')).toMatchObject({ vazio: false, aviso: expect.stringMatching(/de novo/) });
    expect(montarPredio([], null, 'desligada')).toMatchObject({ vazio: true, aviso: expect.stringMatching(/HERMES_ROOT/) });
    expect(montarPredio(ocioso, null, 'desligada')).toMatchObject({ vazio: false, aviso: expect.stringMatching(/uso por assinatura desligado/i) });
  });

  it('cota do Antigravity com janela legível', () => {
    const uso = usoReal as UsoHermes;
    const janelas = montarPredio([], uso, 'ok').cotas.map((c) => c.janela);
    expect(janelas).toContain('5 h');
    expect(janelas).toContain('7 dias');
    expect(janelas.some((j) => /cincoHoras|seteDias/.test(j))).toBe(false);
  });

  it('cota do Antigravity rotulada e traduzida (JSON real)', () => {
    const uso = usoReal as UsoHermes;
    expect(linhaCotas(montarPredio([], uso, 'ok').cotas)).toBe(
      'Cota do Antigravity livre: Claude/GPT 100% (5 h), 100% (7 d) · Gemini 100% (5 h), 85% (7 d)',
    );
    expect(linhaCotas([])).toBeUndefined();
  });

  it('JSON real: Antigravity rotulado como "Antigravity (Gemini)" e Desconhecido com dica', () => {
    const l = Object.fromEntries(linhasUso(usoReal as UsoHermes).map((x) => [x.rotulo, x]));
    expect(l['Antigravity (Gemini)']!.dica).toBeUndefined();
    expect(l.Desconhecido).toMatchObject({ seteDias: expect.any(Number), dica: 'sessões sem provedor registrado' });
  });

  it('perfil à toa mostra o último modelo usado na sala', () => {
    const modelo = { assinatura: 'grok' as const, rotulo: 'Grok', model: 'grok-4.7', nome: 'Grok 4.7', provider: 'xai-oauth', ocioso: true };
    const v = montarPredio([{ id: 'hermes:judge', provider: 'hermes', name: 'judge', hermesModelo: modelo }], null, 'ok');
    expect(ocupante(v, 'judge')).toMatchObject({ estado: 'cafe', modelo });
  });

  it('tokens curtos', () => {
    expect(tokensCurto(0)).toBe('0');
    expect(tokensCurto(950)).toBe('950');
    expect(tokensCurto(1_840_000)).toBe('1,8 mi');
    expect(tokensCurto(320_000)).toBe('320 mil');
  });
});
