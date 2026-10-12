// PROTÓTIPO DESCARTÁVEL — branch prototipo/predio-animado (nunca vai para a main).
// Cartão escritorio t_f888b0ad: vista "Prédio" em pixel art animada, reaproveitando a arte do habblaud
// (personagens, mesas, cadeiras, ícones, pisos, janela com céu).
//   ?prototipo=predio-animado&opcao=a  → o prédio é a tela inicial; tocar num andar dá zoom nas salas dele.
//   ?prototipo=predio-animado&opcao=b  → botão Salas ⇄ Prédio debaixo da barra, lembrando a escolha.
// Dados: exemploPredio() (demonstração). Sem teste, sem persistência além da escolha da opção B.
import {
  appearanceFromSeed,
  characterSprite,
  drawFloor,
  drawWindowView,
  furnitureSprites,
  hash32,
  iconSprite,
  poseFrameCount,
  poseFrameDuration,
  type FloorKind,
  type HeldItem,
  type IconName,
  type Pose,
  type Dir,
} from '../art';
import type { HermesModelo } from '../../../shared/types';
import { exemploPredio, montarPredio, ROTULO_ESTADO, tokensCurto, type AndarId, type AndarVista, type Ocupante, type PredioVista } from '../ui/predio-model';
import type { WorldApi } from '../world/api';

const S = 2; // 1 px de mundo = 2 px de tela (inteiro: pixel nítido)
const FPS_MS = 120;
const CHAVE_B = 'escritorio.prototipo.vista';

type Opcao = 'a' | 'b';

// ------------------------------------------------------------------ dados de demonstração

/** Modelo de demonstração para quem não tem selo no exemplo (o card t_c16a781f traz o "último modelo usado"). */
function modeloDemo(perfil: string): HermesModelo {
  const tabela: HermesModelo[] = [
    { assinatura: 'claude', rotulo: 'Claude', model: 'claude-opus-5-5', nome: 'Claude Opus 5.5', provider: 'anthropic' },
    { assinatura: 'codex', rotulo: 'Codex', model: 'gpt-5.5', nome: 'GPT-5.5', provider: 'openai-codex' },
    { assinatura: 'agy-gemini', rotulo: 'AG Gemini', model: 'gemini-3.1-pro', nome: 'Gemini 3.1 Pro', provider: 'antigravity-agy' },
    { assinatura: 'grok', rotulo: 'Grok', model: 'grok-4-fast-reasoning', nome: 'Grok 4 Fast', provider: 'xai-oauth' },
  ];
  return tabela[hash32(perfil) % tabela.length]!;
}

function vistaDemo(): PredioVista {
  const ex = exemploPredio();
  // Mais gente no prédio, como num dia normal (plantão, produto, um 2º dev).
  ex.agentes.push(
    { id: 'h:produto', provider: 'hermes', name: 'produto', hermes: { board: 'produto', taskId: 't_p', title: 'Rodada 2 com o Victor', state: 'running' } },
    { id: 'h:plantao', provider: 'hermes', name: 'plantao' },
    { id: 'h:pl-infra', provider: 'hermes', name: 'pl-infra' },
    { id: 'h:dev2', provider: 'hermes', name: 'Nise da Silveira (dev)', hermesProfile: 'dev', hermesSlot: 2, hermes: { board: 'openhealth', taskId: 't_d2', title: 'Gráfico de pressão por semana', state: 'running' } },
  );
  const v = montarPredio(ex.agentes, ex.uso);
  for (const a of v.andares) for (const s of a.salas) for (const o of s.ocupantes) if (!o.modelo && o.perfil !== 'victor') o.modelo = modeloDemo(o.perfil);
  return v;
}

// ------------------------------------------------------------------ selo e estado

interface SeloCurto {
  texto: string;
  cor: string;
  reserva: boolean;
  titulo: string;
}

const COR_ASSINATURA: Record<string, [string, string]> = {
  claude: ['Claude', '#d97757'],
  codex: ['ChatGPT', '#10a37f'],
  'agy-gemini': ['Gemini', '#4c8df6'],
  'agy-claude': ['Claude AG', '#a07bd8'],
  grok: ['Grok', '#c9ced8'],
  outro: ['Outro', '#8b98b3'],
};

function selo(m: HermesModelo | undefined): SeloCurto | null {
  if (!m) return null;
  const [texto, cor] = COR_ASSINATURA[m.assinatura] ?? [m.rotulo, '#8b98b3'];
  if (m.reserva) return { texto: '↪ reserva', cor: '#ff9f1c', reserva: true, titulo: `${m.nome} (reserva; principal: ${m.principal ?? '?'} — ${m.motivo ?? '?'})` };
  return { texto, cor, reserva: false, titulo: `${m.nome} · ${m.provider}` };
}

const COR_ESTADO: Record<string, string> = {
  running: '#4fd18b',
  blocked: '#ffb547',
  guarded: '#ff6b6b',
  delivering: '#b69cff',
  cafe: '#9aa4b8',
  conversando: '#3cd8d2',
  fora: '#9aa4b8',
};

interface Cena {
  pose: Pose;
  dir: Dir;
  held?: HeldItem;
  sentado: boolean;
  icone?: IconName;
  anda?: boolean;
}

function cenaDe(o: Ocupante, andar: AndarId): Cena {
  if (o.perfil === 'victor') return o.estado === 'blocked' ? { pose: 'raise_hand', dir: 'down', sentado: true, icone: 'alert' } : { pose: 'read', dir: 'down', held: 'papers', sentado: true };
  switch (o.estado) {
    case 'running':
      return { pose: 'type', dir: 'down', sentado: true };
    case 'blocked':
      return { pose: 'raise_hand', dir: 'down', sentado: true, icone: 'alert' };
    case 'guarded':
      return { pose: 'sulk', dir: 'down', sentado: true, icone: 'storm' };
    case 'delivering':
      return { pose: 'walk', dir: 'right', held: 'box', sentado: false, icone: 'box', anda: true };
    case 'conversando':
      return { pose: 'talk', dir: 'down', held: 'phone', sentado: false, icone: 'chat' };
    case 'fora':
      return andar === 'terreo' ? { pose: 'stand', dir: 'down', sentado: false } : { pose: 'sleep', dir: 'down', sentado: true, icone: 'zzz' };
    default:
      return { pose: 'drink', dir: 'down', held: 'coffee', sentado: false, icone: 'coffee' };
  }
}

const PISO: Record<AndarId, FloorKind> = { cobertura: 'wood', produto: 'carpet', ti: 'tile_white', terreo: 'marble' };
const TINTA: Record<AndarId, [string, string]> = {
  cobertura: ['#b98a5e', '#a77a50'],
  produto: ['#6f7fa8', '#64739a'],
  ti: ['#c9d1dc', '#bcc5d2'],
  terreo: ['#d8d4cc', '#cbc6bd'],
};
const PAREDE: Record<AndarId, string> = { cobertura: '#e9dcc6', produto: '#dfe6f1', ti: '#e6ebf2', terreo: '#efe9df' };

// ------------------------------------------------------------------ desenho de uma mesa (célula)

interface Celula {
  canvas: HTMLCanvasElement;
  o: Ocupante | null;
  andar: AndarId;
  w: number;
  h: number;
  seed: number;
}

function novaCelula(o: Ocupante | null, andar: AndarId, w: number, h: number): Celula {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w * S}px`;
  canvas.style.height = `${h * S}px`;
  canvas.className = 'pv-px';
  canvas.setAttribute('aria-hidden', 'true');
  return { canvas, o, andar, w, h, seed: hash32(o ? (o.agentId ?? o.perfil) : `vazia:${andar}`) };
}

function desenharCelula(c: Celula, t: number, comMesa: boolean): void {
  const ctx = c.canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const [t1, t2] = TINTA[c.andar];
  drawFloor(ctx, PISO[c.andar], 0, 0, c.w, c.h, { seed: 7, tint: t1, tint2: t2 });
  // parede do fundo com rodapé
  ctx.fillStyle = PAREDE[c.andar];
  ctx.fillRect(0, 0, c.w, 6);
  ctx.fillStyle = 'rgba(40,48,66,0.35)';
  ctx.fillRect(0, 6, c.w, 1);
  const cx = Math.round(c.w / 2);
  const baseCadeira = c.h - 17;
  const o = c.o;
  const cena = o ? cenaDe(o, c.andar) : null;
  const mesa = comMesa && c.andar !== 'terreo';
  const desenhaMesa = () => {
    if (!mesa) return;
    const d = furnitureSprites(o?.perfil === 'victor' ? 'desk_back' : 'desk_back', o?.perfil === 'victor' ? 'dark' : 'white');
    ctx.drawImage(d.base.canvas, cx - d.base.ax, c.h - 1 - d.base.ay);
  };
  if (mesa || cena?.sentado) {
    const ch = furnitureSprites('office_chair_front', 'gray');
    ctx.drawImage(ch.base.canvas, cx - ch.base.ax, baseCadeira - ch.base.ay);
  }
  if (!o || !cena) {
    desenhaMesa();
    return;
  }
  const n = poseFrameCount(cena.pose);
  const frame = Math.floor(t / poseFrameDuration(cena.pose) + (c.seed % 7)) % n;
  const ap = appearanceFromSeed(c.seed);
  let x = cx;
  let y = baseCadeira;
  let dir = cena.dir;
  if (!cena.sentado) {
    // em pé ao lado da mesa (ou andando com a caixa até o revisor)
    y = c.h - 2;
    x = mesa ? cx + 10 : cx;
    if (cena.anda) {
      const vai = c.w - 16;
      const p = (t / 2600 + (c.seed % 100) / 100) % 2;
      const u = p < 1 ? p : 2 - p;
      x = 8 + Math.round(u * vai);
      dir = p < 1 ? 'right' : 'left';
    }
  }
  const sp = characterSprite({ appearance: ap, dir, pose: cena.pose, frame, held: cena.held, seated: cena.sentado });
  if (cena.sentado) {
    ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay);
    desenhaMesa();
  } else {
    desenhaMesa();
    ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay);
  }
  if (cena.sentado && mesa && o.estado === 'running') {
    // brilho do monitor batendo no rosto (pisca de leve)
    ctx.fillStyle = `rgba(124,200,255,${0.08 + 0.06 * Math.sin(t / 300 + c.seed)})`;
    ctx.fillRect(cx - 9, baseCadeira - 22, 18, 12);
  }
  if (cena.icone) {
    const ic = iconSprite(cena.icone === 'zzz' ? 'zzz' : cena.icone);
    const pula = Math.round(Math.sin(t / 260 + c.seed) * 1.5);
    const iy = Math.max(1, y - sp.ay - 4 + pula);
    if (cena.icone !== 'alert' || Math.floor(t / 450) % 2 === 0 || true) ctx.drawImage(ic.canvas, Math.min(c.w - ic.canvas.width - 1, x + 6), iy);
  }
}

// ------------------------------------------------------------------ DOM

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function seloEl(m: HermesModelo | undefined): HTMLElement | null {
  const s = selo(m);
  if (!s) return null;
  const e = el('span', `pv-selo${s.reserva ? ' pv-selo--reserva' : ''}`, s.texto);
  e.style.setProperty('--c', s.cor);
  e.title = s.titulo;
  return e;
}

function nomeCurto(o: Ocupante): string {
  return o.nome.replace(/\s*\([^)]*\)\s*$/, '');
}

function estadoEl(o: Ocupante): HTMLElement {
  const e = el('span', 'pv-estado');
  const dot = el('span', 'pv-dot');
  dot.style.background = COR_ESTADO[o.estado] ?? '#9aa4b8';
  e.append(dot, document.createTextNode(o.perfil === 'victor' && o.estado === 'blocked' ? 'portões esperando' : ROTULO_ESTADO[o.estado]));
  return e;
}

/** Painel do topo: uso por assinatura (5 h e 7 dias). */
function usoEl(v: PredioVista): HTMLElement {
  const box = el('section', 'pv-uso');
  box.setAttribute('aria-label', 'Uso por assinatura');
  const tit = el('div', 'pv-uso__tit');
  tit.append(el('span', 'pv-eyebrow', 'Uso por assinatura'), el('span', 'pv-uso__jan', 'tokens'));
  const grade = el('div', 'pv-uso__grade');
  const cores: Record<string, string> = { Claude: '#d97757', ChatGPT: '#10a37f', Gemini: '#4c8df6', Grok: '#c9ced8' };
  for (const l of v.uso) {
    const c = el('div', 'pv-uso__item');
    const nome = el('span', 'pv-uso__nome', l.rotulo);
    nome.style.setProperty('--c', cores[l.rotulo] ?? '#8b98b3');
    c.append(nome, el('span', 'pv-uso__num', `5 h: ${tokensCurto(l.cincoHoras)}`), el('span', 'pv-uso__num', `7 dias: ${tokensCurto(l.seteDias)}`));
    grade.append(c);
  }
  box.append(tit, grade);
  return box;
}

interface Andarzinho {
  andar: AndarVista;
  el: HTMLElement;
  celulas: Celula[];
  comMesa: boolean;
}

function contagem(a: AndarVista): string {
  const os = a.salas.flatMap((s) => s.ocupantes);
  const trab = os.filter((o) => o.estado === 'running').length;
  const mao = os.filter((o) => o.estado === 'blocked').length;
  const red = os.filter((o) => o.estado === 'guarded').length;
  const partes = [`${os.length} ${os.length === 1 ? 'pessoa' : 'pessoas'}`];
  if (trab) partes.push(`${trab} trabalhando`);
  if (mao) partes.push(`${mao} ✋`);
  if (red) partes.push(`${red} placa vermelha`);
  return partes.join(' · ');
}

/** Andar compacto (opção A, visão do prédio): uma fileira de mesas, nome + selo em cada uma. */
function andarCompacto(a: AndarVista, aoTocar: (a: AndarVista, el: HTMLElement) => void): Andarzinho {
  const sec = el('section', `pv-andar pv-andar--${a.id} pv-andar--compacto`);
  const bt = el('button', 'pv-andar__cab');
  bt.type = 'button';
  bt.setAttribute('aria-label', `${a.titulo}: ${contagem(a)}. Tocar para ver as salas`);
  const t = el('span', 'pv-andar__tit', a.titulo);
  const n = el('span', 'pv-andar__n', contagem(a));
  const seta = el('span', 'pv-andar__seta', 'ver salas ›');
  bt.append(t, n, seta);
  const janelas = faixaJanelas(a.id);
  const grade = el('div', 'pv-grade');
  const celulas: Celula[] = [];
  const os = a.salas.flatMap((s) => s.ocupantes);
  for (const o of os) {
    const c = novaCelula(o, a.id, 32, 40);
    celulas.push(c);
    const item = el('div', 'pv-mini');
    item.title = `${o.nome} · ${o.perfil === 'victor' && o.estado === 'blocked' ? 'portões esperando' : ROTULO_ESTADO[o.estado]}${o.detalhe ? ` · ${o.detalhe}` : ''}`;
    const nome = el('span', 'pv-mini__nome');
    const dot = el('span', 'pv-dot');
    dot.style.background = COR_ESTADO[o.estado] ?? '#9aa4b8';
    nome.append(dot, el('span', 'pv-mini__txt', nomeCurto(o)));
    const s = seloEl(o.modelo);
    item.append(c.canvas, nome);
    if (s) item.append(s);
    grade.append(item);
  }
  if (a.placa) {
    const p = el('div', 'pv-placa', `✋ ${a.placa}`);
    sec.append(bt, janelas, p, grade);
  } else sec.append(bt, janelas, grade);
  sec.addEventListener('click', () => aoTocar(a, sec));
  return { andar: a, el: sec, celulas, comMesa: true };
}

/** Andar detalhado (zoom da A e prédio da B): as salas do andar, cada pessoa com nome, estado, selo e cartão. */
function andarDetalhado(a: AndarVista, cabecalho = true): Andarzinho {
  const sec = el('section', `pv-andar pv-andar--${a.id} pv-andar--detalhe`);
  if (cabecalho) {
    const cab = el('div', 'pv-andar__cab pv-andar__cab--fixo');
    cab.append(el('span', 'pv-andar__tit', a.titulo), el('span', 'pv-andar__n', contagem(a)));
    sec.append(cab);
  }
  sec.append(faixaJanelas(a.id));
  if (a.placa) sec.append(el('div', 'pv-placa', `✋ ${a.placa}`));
  const salas = el('div', 'pv-salas');
  const celulas: Celula[] = [];
  for (const s of a.salas) {
    const sala = el('div', 'pv-sala');
    const placa = el('div', 'pv-sala__nome');
    placa.append(el('span', 'pv-eyebrow', s.nome));
    if (s.objeto) placa.append(el('span', 'pv-sala__obj', s.objeto));
    const mesas = el('div', 'pv-sala__mesas');
    if (!s.ocupantes.length) {
      const c = novaCelula(null, a.id, 50, 46);
      celulas.push(c);
      const item = el('div', 'pv-mesa pv-mesa--vazia');
      item.append(c.canvas, el('span', 'pv-mesa__det', 'vazia'));
      mesas.append(item);
    }
    for (const o of s.ocupantes) {
      const c = novaCelula(o, a.id, 50, 46);
      celulas.push(c);
      const item = el('div', `pv-mesa pv-mesa--${o.estado}`);
      const nome = el('span', 'pv-mesa__nome', nomeCurto(o));
      nome.title = o.nome;
      const linha = el('span', 'pv-mesa__linha');
      const sl = seloEl(o.modelo);
      if (sl) linha.append(sl);
      if (o.modelo) linha.append(el('span', 'pv-mesa__modelo', o.modelo.nome.replace(/^Claude |^Gemini |^Grok /, '')));
      item.append(c.canvas, nome, estadoEl(o));
      if (sl) item.append(linha);
      if (o.detalhe) {
        const d = el('span', 'pv-mesa__det', o.detalhe);
        d.title = o.detalhe;
        item.append(d);
      }
      if (o.estado === 'guarded') item.append(el('span', 'pv-red', 'placa vermelha'));
      mesas.append(item);
    }
    sala.append(placa, mesas);
    salas.append(sala);
  }
  sec.append(salas);
  return { andar: a, el: sec, celulas, comMesa: true };
}

/** Faixa de janelas no alto de cada andar, com o céu da hora (drawWindowView do habblaud). */
const faixas: { c: HTMLCanvasElement; seed: number }[] = [];
function faixaJanelas(id: AndarId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'pv-px pv-janelas';
  c.setAttribute('aria-hidden', 'true');
  c.height = 12;
  faixas.push({ c, seed: hash32(id) });
  return c;
}
function desenharFaixa(f: { c: HTMLCanvasElement; seed: number }, t: number, hora: number, id: AndarId | null): void {
  const largura = Math.max(16, Math.round(f.c.clientWidth / S));
  if (f.c.width !== largura) f.c.width = largura;
  const ctx = f.c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = id ? PAREDE[id] : '#e6ebf2';
  ctx.fillRect(0, 0, f.c.width, 12);
  for (let x = 4; x + 18 <= f.c.width; x += 24) {
    ctx.fillStyle = '#5b6478';
    ctx.fillRect(x - 1, 1, 20, 10);
    drawWindowView(ctx, { x, y: 2, w: 18, h: 8 }, hora, t, f.seed + x);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x + 8, 2, 1, 8);
  }
}

function legendaEl(): HTMLElement {
  const box = el('div', 'pv-leg');
  box.setAttribute('aria-label', 'Legenda');
  const itens: [string, string][] = [
    ['running', 'trabalhando (digitando)'],
    ['blocked', 'precisa de você (mão levantada)'],
    ['guarded', 'placa vermelha'],
    ['delivering', 'entregando ao revisor (📦)'],
    ['cafe', 'café / à toa'],
    ['conversando', 'persona conversando'],
  ];
  for (const [k, t] of itens) {
    const i = el('span', 'pv-leg__i');
    const d = el('span', 'pv-dot');
    d.style.background = COR_ESTADO[k]!;
    i.append(d, document.createTextNode(t));
    box.append(i);
  }
  return box;
}

/** Rua com o caminhão do deployer (só anda quando o deployer tem deploy rodando). */
function rua(v: PredioVista): { el: HTMLElement; desenha: (t: number) => void } {
  const box = el('div', 'pv-rua');
  const c = document.createElement('canvas');
  c.className = 'pv-px';
  c.setAttribute('aria-hidden', 'true');
  c.height = 30;
  const dep = v.andares.flatMap((a) => a.salas.flatMap((s) => s.ocupantes)).find((o) => o.perfil === 'deployer');
  const rodando = dep?.estado === 'running';
  const leg = el('div', 'pv-rua__leg', rodando ? `🚚 Deploy rodando: ${dep?.detalhe ?? ''}` : 'Doca do deployer: sem deploy agora');
  box.append(c, leg);
  const desenha = (t: number) => {
    const w = Math.max(16, Math.round(c.clientWidth / S));
    if (c.width !== w) c.width = w;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    drawFloor(ctx, 'sidewalk', 0, 0, w, 10, { seed: 3 });
    drawFloor(ctx, 'street', 0, 10, w, 20, { seed: 3 });
    if (!rodando) return;
    const ciclo = 9000;
    const x = Math.round(((t % ciclo) / ciclo) * (w + 60)) - 50;
    caminhao(ctx, x, 12, t);
  };
  return { el: box, desenha };
}

function caminhao(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  // baú
  ctx.fillStyle = '#2b3245';
  ctx.fillRect(x, y, 30, 14);
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(x + 1, y + 1, 28, 12);
  ctx.fillStyle = '#4fd18b';
  ctx.fillRect(x + 3, y + 5, 24, 3);
  // cabine
  ctx.fillStyle = '#2b3245';
  ctx.fillRect(x + 30, y + 4, 12, 10);
  ctx.fillStyle = '#e8644f';
  ctx.fillRect(x + 31, y + 5, 10, 8);
  ctx.fillStyle = '#9fd4ff';
  ctx.fillRect(x + 36, y + 6, 4, 3);
  // rodas
  const r = Math.floor(t / 120) % 2;
  for (const rx of [x + 6, x + 22, x + 36]) {
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(rx, y + 13, 5, 4);
    ctx.fillStyle = '#8b93a5';
    ctx.fillRect(rx + 1 + r, y + 14, 2, 2);
  }
  // fumacinha
  ctx.fillStyle = 'rgba(200,205,215,0.7)';
  ctx.fillRect(x - 3 - (Math.floor(t / 200) % 3), y + 11, 2, 2);
}

// ------------------------------------------------------------------ montagem

export function montarPrototipo(opts: { root: HTMLElement; topbar: HTMLElement; world: WorldApi }): void {
  const q = protoParams();
  const opcao: Opcao = q.get('opcao') === 'b' ? 'b' : 'a';
  document.documentElement.classList.add('pv-on');
  injetarCss();
  const vista = vistaDemo();
  const hora = new Date().getHours() + new Date().getMinutes() / 60;

  // faixa do protótipo no topo (troca pelo #hash: funciona também no HTML estático aberto do celular)
  const faixa = el('nav', 'pv-faixa');
  faixa.setAttribute('aria-label', 'Protótipo: escolher opção');
  faixa.append(el('span', 'pv-faixa__tit', 'Protótipo'));
  for (const o of ['a', 'b'] as const) {
    const a = el('a', `pv-faixa__op${o === opcao ? ' is-on' : ''}`, `Opção ${o.toUpperCase()}`);
    a.href = `#opcao=${o}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = `opcao=${o}`;
      location.reload();
    });
    if (o === opcao) a.setAttribute('aria-current', 'page');
    faixa.append(a);
  }
  document.body.append(faixa);

  const camada = el('div', 'pv-camada');
  camada.setAttribute('role', 'region');
  camada.setAttribute('aria-label', 'Prédio do time');
  const miolo = el('div', 'pv-miolo');
  camada.append(miolo);
  opts.root.append(camada);

  const posicionar = () => {
    const base = opts.root.getBoundingClientRect().top;
    const b = opts.topbar.getBoundingClientRect().bottom - base;
    camada.style.top = `${Math.round(b)}px`;
    if (alternador) alternador.style.top = `${Math.round(b) + 8}px`;
  };

  let andares: Andarzinho[] = [];
  let ruaAtual: ReturnType<typeof rua> | null = null;
  let alternador: HTMLElement | null = null;

  const predioInteiro = (modo: 'compacto' | 'detalhe', aoTocar?: (a: AndarVista, el: HTMLElement) => void) => {
    faixas.length = 0;
    const predio = el('div', `pv-predio pv-predio--${modo}`);
    const telhado = el('div', 'pv-telhado');
    telhado.append(el('div', 'pv-antena'), usoEl(vista));
    predio.append(telhado);
    andares = vista.andares.map((a) => (modo === 'compacto' ? andarCompacto(a, aoTocar!) : andarDetalhado(a)));
    for (const a of andares) predio.append(a.el);
    ruaAtual = rua(vista);
    predio.append(ruaAtual.el, legendaEl());
    return predio;
  };

  // ---------------- opção A: prédio é a tela inicial; andar → zoom nas salas
  const mostrarPredioA = () => {
    miolo.replaceChildren();
    const intro = el('p', 'pv-intro', 'Toque num andar para ver as salas.');
    const predio = predioInteiro('compacto', (a, alvo) => zoomA(a, alvo));
    const mapa = el('button', 'pv-sec', 'Ver o mapa dos projetos (salas antigas)');
    mapa.type = 'button';
    mapa.addEventListener('click', () => irMapa());
    miolo.append(intro, predio, mapa);
    camada.hidden = false;
    camada.scrollTop = 0;
  };
  const zoomA = (a: AndarVista, alvo: HTMLElement) => {
    const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fim = () => mostrarAndarA(a.id);
    if (reduz) return fim();
    const r = alvo.getBoundingClientRect();
    const cr = camada.getBoundingClientRect();
    const predio = miolo.querySelector('.pv-predio') as HTMLElement;
    const pr = predio.getBoundingClientRect();
    predio.style.transformOrigin = `${r.left + r.width / 2 - pr.left}px ${r.top + r.height / 2 - pr.top}px`;
    predio.classList.add('pv-zoom');
    alvo.classList.add('pv-alvo');
    void cr;
    setTimeout(fim, 380);
  };
  const mostrarAndarA = (id: AndarId) => {
    const i = vista.andares.findIndex((x) => x.id === id);
    const a = vista.andares[i]!;
    miolo.replaceChildren();
    faixas.length = 0;
    const nav = el('div', 'pv-zoomnav');
    const volta = el('button', 'pv-btn', '‹ Prédio');
    volta.type = 'button';
    volta.addEventListener('click', () => mostrarPredioA());
    const tit = el('div', 'pv-zoomnav__tit');
    tit.append(el('span', 'pv-andar__tit', a.titulo), el('span', 'pv-andar__n', contagem(a)));
    const sobe = el('button', 'pv-btn pv-btn--ic', '▲');
    sobe.type = 'button';
    sobe.setAttribute('aria-label', 'Andar de cima');
    sobe.disabled = i === 0;
    sobe.addEventListener('click', () => mostrarAndarA(vista.andares[i - 1]!.id));
    const desce = el('button', 'pv-btn pv-btn--ic', '▼');
    desce.type = 'button';
    desce.setAttribute('aria-label', 'Andar de baixo');
    desce.disabled = i === vista.andares.length - 1;
    desce.addEventListener('click', () => mostrarAndarA(vista.andares[i + 1]!.id));
    nav.append(volta, tit, sobe, desce);
    const det = andarDetalhado(a, false);
    det.el.classList.add('pv-entra');
    andares = [det];
    const pred = el('div', 'pv-predio pv-predio--detalhe');
    pred.append(det.el);
    if (id === 'terreo') {
      ruaAtual = rua(vista);
      pred.append(ruaAtual.el);
    } else ruaAtual = null;
    miolo.append(nav, pred);
    camada.scrollTop = 0;
  };
  let botaoVolta: HTMLElement | null = null;
  const irMapa = () => {
    camada.hidden = true;
    opts.world.overview();
    if (!botaoVolta) {
      botaoVolta = el('button', 'pv-btn pv-flutua', '‹ Prédio');
      (botaoVolta as HTMLButtonElement).type = 'button';
      botaoVolta.addEventListener('click', () => {
        botaoVolta!.hidden = true;
        mostrarPredioA();
      });
      opts.root.append(botaoVolta);
    }
    botaoVolta.hidden = false;
    posicionarFlutua();
  };
  const posicionarFlutua = () => {
    if (botaoVolta) botaoVolta.style.top = `${Math.round(opts.topbar.getBoundingClientRect().bottom - opts.root.getBoundingClientRect().top) + 8}px`;
  };

  // ---------------- opção B: alternador Salas ⇄ Prédio (lembrado)
  const montarB = () => {
    alternador = el('div', 'pv-alterna');
    alternador.setAttribute('role', 'group');
    alternador.setAttribute('aria-label', 'Vista');
    const bS = el('button', 'pv-alterna__op', 'Salas');
    const bP = el('button', 'pv-alterna__op', 'Prédio');
    for (const b of [bS, bP]) (b as HTMLButtonElement).type = 'button';
    alternador.append(bS, bP);
    opts.root.append(alternador);
    let lembrada = 'salas';
    try {
      lembrada = localStorage.getItem(CHAVE_B) ?? (q.has('predio') ? 'predio' : 'salas');
    } catch {
      /* sem localStorage */
    }
    if (q.get('vista')) lembrada = q.get('vista')!;
    const aplica = (v: string) => {
      const ehPredio = v === 'predio';
      bS.setAttribute('aria-pressed', String(!ehPredio));
      bP.setAttribute('aria-pressed', String(ehPredio));
      camada.hidden = !ehPredio;
      camada.classList.toggle('pv-camada--b', true);
      try {
        localStorage.setItem(CHAVE_B, v);
      } catch {
        /* sem localStorage */
      }
    };
    bS.addEventListener('click', () => aplica('salas'));
    bP.addEventListener('click', () => aplica('predio'));
    miolo.append(predioInteiro('detalhe'));
    aplica(lembrada);
  };

  if (opcao === 'a') mostrarPredioA();
  else montarB();
  posicionar();
  addEventListener('resize', () => {
    posicionar();
    posicionarFlutua();
  });
  new ResizeObserver(() => {
    posicionar();
    posicionarFlutua();
  }).observe(opts.topbar);

  // ---------------- animação (8 quadros/s, só o que está na tela)
  let ultimo = 0;
  const passo = (agora: number) => {
    requestAnimationFrame(passo);
    if (camada.hidden || agora - ultimo < FPS_MS) return;
    ultimo = agora;
    for (const a of andares) for (const c of a.celulas) desenharCelula(c, agora, a.comMesa);
    for (const f of faixas) desenharFaixa(f, agora, hora, (f.c.closest('.pv-andar')?.className.match(/pv-andar--(cobertura|produto|ti|terreo)/)?.[1] as AndarId) ?? null);
    ruaAtual?.desenha(agora);
  };
  requestAnimationFrame(passo);
}

function injetarCss(): void {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.append(st);
}

const CSS = `
html.pv-on #ui { top: 44px; transform: translateZ(0); }
html.pv-on #world { top: 44px; height: calc(100vh - 44px); }
.pv-faixa { position: fixed; inset: 0 0 auto 0; height: 44px; z-index: 9999; display: flex; align-items: center; gap: 6px;
  padding: 0 10px; background: #2a1f05; border-bottom: 1px solid #ffb547; font: 600 13px/1 system-ui, sans-serif; color: #ffe2a8; }
.pv-faixa__tit { margin-right: auto; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; }
.pv-faixa__op { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 12px; color: #ffe2a8; text-decoration: none; border-radius: 8px; }
.pv-faixa__op.is-on { background: #ffb547; color: #1b1405; }
.pv-faixa__op:focus-visible, .pv-btn:focus-visible, .pv-andar--compacto:focus-within, .pv-alterna__op:focus-visible, .pv-sec:focus-visible, .pv-andar__cab:focus-visible { outline: 2px solid #7cc8ff; outline-offset: 2px; }

.pv-camada { position: fixed; left: 0; right: 0; bottom: 0; top: 64px; z-index: 40; overflow-y: auto; overflow-x: hidden;
  background: linear-gradient(#0f1a2e, #12151d 420px); color: #e8ecf5; font-family: var(--font-ui); -webkit-overflow-scrolling: touch; }
.pv-camada[hidden] { display: none; }
.pv-miolo { max-width: 1120px; margin: 0 auto; padding: 10px 6px 72px; }
.pv-px { image-rendering: pixelated; display: block; }
.pv-intro { margin: 2px 2px 10px; color: #c3cad8; font-size: 14px; }
.pv-eyebrow { font: 700 11px/1.2 var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: #c3cad8; }

.pv-predio { position: relative; max-width: 780px; margin: 0 auto; transition: transform .38s cubic-bezier(.22,.8,.24,1), opacity .38s; }
.pv-predio.pv-zoom { transform: scale(1.9); opacity: 0; }
.pv-telhado { position: relative; margin: 0 14px; padding: 10px 10px 8px; background: #2b3245; border: 2px solid #48526b; border-bottom: 0; border-radius: 6px 6px 0 0; }
.pv-antena { position: absolute; right: 18px; top: -22px; width: 4px; height: 22px; background: #8b93a5; }
.pv-antena::after { content: ''; position: absolute; left: -3px; top: -6px; width: 10px; height: 6px; background: #ff6b6b; animation: pv-pisca 1.4s steps(2) infinite; }
@keyframes pv-pisca { 50% { background: #5a2626; } }
.pv-uso__tit { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.pv-uso__jan { font-size: 12px; color: #c3cad8; }
.pv-uso__grade { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4px 12px; }
@media (min-width: 700px) { .pv-uso__grade { grid-template-columns: repeat(4, minmax(0,1fr)); } }
.pv-uso__item { display: flex; flex-direction: column; gap: 2px; font-size: 13px; padding: 5px 7px; background: #1d2333; border-radius: 4px; min-width: 0; }
.pv-uso__nome { font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.pv-uso__nome::before { content: ''; width: 8px; height: 8px; background: var(--c); }
.pv-uso__num { color: #dfe4ee; font-size: 12px; font-variant-numeric: tabular-nums; }
.pv-leg { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 8px 4px; font-size: 12px; color: #dfe4ee; }
.pv-leg__i { display: inline-flex; align-items: center; gap: 5px; }

.pv-andar { position: relative; background: #1a1f2c; border-left: 6px solid #48526b; border-right: 6px solid #48526b; border-top: 5px solid #5d6680; }
.pv-andar--compacto { cursor: pointer; }
.pv-andar--compacto:hover { background: #1f2536; }
.pv-andar__cab { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; width: 100%; min-height: 44px; padding: 8px 10px; background: #12151d; color: #e8ecf5; text-align: left; border: 0; font: inherit; cursor: pointer; }
.pv-andar__cab--fixo { cursor: default; }
.pv-andar__tit { font: 700 14px/1.2 var(--font-ui); letter-spacing: .05em; text-transform: uppercase; }
.pv-andar__n { font-size: 12px; color: #c3cad8; }
.pv-andar__seta { margin-left: auto; font-size: 13px; color: #7cc8ff; }
.pv-janelas { width: 100%; height: 24px; }
.pv-placa { margin: 6px 8px 0; padding: 6px 8px; background: #3a2a0a; color: #ffd27a; border: 1px solid #ffb547; font-size: 13px; font-weight: 700; border-radius: 4px; }
.pv-grade { display: flex; flex-wrap: wrap; gap: 3px; padding: 6px 2px 8px; }
.pv-mini { width: 66px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.pv-mini canvas { border-radius: 2px; }
.pv-mini__nome { display: flex; align-items: center; gap: 3px; max-width: 66px; font-size: 12px; font-weight: 600; line-height: 1.2; color: #e8ecf5; }
.pv-mini__txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-dot { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.pv-selo { display: inline-flex; align-items: center; height: 16px; padding: 0 4px; border-radius: 3px; background: color-mix(in srgb, var(--c) 24%, #12151d);
  box-shadow: inset 0 0 0 1px var(--c); color: #f3f5fa; font: 700 11px/1 var(--font-ui); letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; overflow: hidden; max-width: 100%; }
.pv-selo--reserva { background: #ff9f1c; color: #1b1405; box-shadow: none; }
.pv-mini .pv-selo { max-width: 66px; padding: 0 3px; letter-spacing: 0; }

.pv-salas { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; }
.pv-sala { background: #12151d; border: 2px solid #3a4258; border-radius: 4px; }
.pv-sala__nome { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 4px 6px; border-bottom: 1px solid #3a4258; }
.pv-sala__obj { font-size: 12px; color: #c3cad8; }
.pv-sala__mesas { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; }
.pv-mesa { width: 100px; display: flex; flex-direction: column; gap: 3px; padding-bottom: 4px; }
.pv-mesa__nome { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-estado { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #dfe4ee; line-height: 1.2; }
.pv-mesa__linha { display: flex; align-items: center; gap: 4px; min-width: 0; }
.pv-mesa__linha .pv-selo { flex: none; }
@media (max-width: 500px) { .pv-mesa__modelo { display: none; } }
.pv-mesa__modelo { font-size: 12px; color: #c3cad8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-mesa__det { font-size: 12px; color: #c3cad8; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pv-mesa--blocked .pv-mesa__det { color: #ffd27a; }
.pv-red { align-self: flex-start; font: 700 11px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; padding: 3px 5px; background: #ff6b6b; color: #1d0606; border-radius: 3px; }

.pv-rua { border-left: 6px solid transparent; border-right: 6px solid transparent; }
.pv-rua canvas { width: 100%; height: 60px; }
.pv-rua__leg { padding: 6px 4px; font-size: 13px; color: #dfe4ee; }

.pv-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 8px;
  background: #222a3b; color: #e8ecf5; border: 1px solid #48526b; font: 600 14px/1 var(--font-ui); cursor: pointer; }
.pv-btn:disabled { opacity: .4; cursor: default; }
.pv-zoomnav { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 6px 0 8px; background: #12151d; }
.pv-zoomnav__tit { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pv-entra { animation: pv-entra .32s cubic-bezier(.22,.8,.24,1); }
@keyframes pv-entra { from { transform: scale(.6); opacity: 0; } }
.pv-sec { display: block; width: 100%; min-height: 44px; margin-top: 12px; padding: 10px; background: none; border: 1px dashed #48526b; border-radius: 8px; color: #c3cad8; font: 600 14px/1.2 var(--font-ui); cursor: pointer; }
.pv-flutua { position: fixed; left: 10px; z-index: 45; }

.pv-alterna { position: fixed; left: 50%; transform: translateX(-50%); z-index: 45; display: flex; padding: 3px; background: #12151d; border: 1px solid #48526b; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.pv-alterna__op { min-height: 44px; min-width: 88px; padding: 0 14px; border-radius: 8px; color: #e8ecf5; font: 600 14px/1 var(--font-ui); background: none; border: 0; cursor: pointer; }
.pv-alterna__op[aria-pressed='true'] { background: #7cc8ff; color: #0b1320; }
.pv-camada--b .pv-miolo { padding-top: 64px; }
@media (prefers-reduced-motion: reduce) { .pv-predio, .pv-entra { transition: none; animation: none; } }
`;

/** Parâmetros do protótipo: padrão do HTML estático (window.__PROTO_QS) + ?query + #hash (o hash vence). */
export function protoParams(): URLSearchParams {
  if (typeof location === 'undefined') return new URLSearchParams();
  const base = (globalThis as { __PROTO_QS?: string }).__PROTO_QS ?? '';
  const q = new URLSearchParams(base);
  for (const fonte of [location.search, location.hash.slice(1)]) for (const [k, v] of new URLSearchParams(fonte)) q.set(k, v);
  return q;
}

export const PROTOTIPO_ATIVO = protoParams().get('prototipo') === 'predio-animado';
