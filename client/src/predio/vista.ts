// Vista Prédio (specs/predio-vertical.md, D1, D3 e D9; fatia S6): o botão "Salas | Prédio" logo abaixo da barra de
// cima (lembrado em localStorage['escritorio.vista']; ?vista= na URL vence) e, no Prédio, a camada com o mapinha
// vertical do time: andares empilhados, coluna do elevador à direita, placas dos andares, nomes das salas e o crachá
// (nome + selo) acima de cada boneco, com + e − de zoom. Salas ativa = camada escondida e loop parado.
// Dados: montarPredio(snapshot.agents, null); no ?mock=1 sem agentes do Hermes, exemploPredio().agentes.
// Ainda não (S7): tocar no andar, enquadrar sem corte, crachás desviando de móvel, window.__predio. (S8): viagens.
import * as artModule from '../art';
import { TILE } from '../art/api';
import type { UiComponent, UiContext } from '../ui/context';
import { seloModelo } from '../ui/hermes-selo';
import { exemploPredio, montarPredio, ROTULO_ESTADO, type AgentePredio, type Ocupante, type PredioVista } from '../ui/predio-model';
import type { AreaLayout } from '../world/layout/types';
import { PathFinder } from '../world/path/astar';
import { Bonecos, type Boneco } from './bonecos';
import { BX, LAJE, montarCena, WT, type AndarCena, type Cena } from './planta';
import { areasVis, desenhar, type ArtPredio, type Quadro } from './render';

const art: ArtPredio = artModule;
const CHAVE = 'escritorio.vista';
type Vista = 'salas' | 'predio';
/** Desenho a 12 quadros/s (a simulação anda a cada quadro). */
const FPS_MS = 1000 / 12;
const ESCALA_MAX = 3;
const FATOR_ZOOM = 1.6;
const WPX = WT * TILE;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function nomeCurto(o: Ocupante): string {
  return o.nome.replace(/\s*\((dev|devcodex|devgemini)\)$/, '').split(' ')[0]!;
}

function lerVista(): Vista {
  const daUrl = new URLSearchParams(location.search).get('vista');
  if (daUrl === 'predio' || daUrl === 'salas') {
    gravarVista(daUrl);
    return daUrl;
  }
  try {
    return localStorage.getItem(CHAVE) === 'predio' ? 'predio' : 'salas';
  } catch {
    return 'salas'; // sem localStorage: funciona sem lembrar
  }
}

function gravarVista(v: Vista): void {
  try {
    localStorage.setItem(CHAVE, v);
  } catch {
    /* sem localStorage */
  }
}

/** Chave da cena: só remonta quando muda o conjunto de salas (D2). */
function chaveCena(v: PredioVista): string {
  return v.andares.map((a) => a.salas.map((s) => s.id).join(',')).join('|');
}

interface Cracha {
  b: Boneco;
  el: HTMLElement;
  assinatura: string;
}

interface Montada {
  chave: string;
  cena: Cena;
  quadro: Quadro;
  pf: PathFinder;
  bonecos: Bonecos;
  placasAndar: { a: AndarCena; el: HTMLButtonElement; resumo: HTMLElement }[];
  placasSala: { area: AreaLayout; el: HTMLElement }[];
}

export class VistaPredio implements UiComponent {
  /** Raiz do componente (alternador, camada e botões de zoom ficam dentro, todos `position: fixed`). */
  readonly el = el('div', 'pred');
  private readonly alterna = el('div', 'pred-alterna');
  private readonly bSalas = el('button', 'pred-alterna__op', 'Salas');
  private readonly bPredio = el('button', 'pred-alterna__op', 'Prédio');
  private readonly camada = el('div', 'pred-camada');
  private readonly palco = el('div', 'pred-palco');
  private readonly tela = el('canvas', 'pred-tela');
  private readonly rotulos = el('div', 'pred-rotulos');
  private readonly zoom = el('div', 'pred-zoom');
  private vista: Vista;
  private m: Montada | null = null;
  private assinatura = '';
  private readonly crachas = new Map<string, Cracha>();
  private escala = 1;
  private detalhe = false;
  private raf = 0;
  private ultimo = 0;
  private ultDesenho = 0;
  private ultExpirar = 0;
  private semente = 12345;
  private readonly rnd = () => (this.semente = (this.semente * 1103515245 + 12345) >>> 0) / 0xffffffff;

  constructor(
    private readonly ctx: UiContext,
    private readonly topbar: HTMLElement,
  ) {
    this.alterna.setAttribute('role', 'group');
    this.alterna.setAttribute('aria-label', 'Vista');
    for (const b of [this.bSalas, this.bPredio]) b.type = 'button';
    this.alterna.append(this.bSalas, this.bPredio);
    this.bSalas.addEventListener('click', () => this.trocar('salas'));
    this.bPredio.addEventListener('click', () => this.trocar('predio'));

    this.camada.setAttribute('role', 'region');
    this.camada.setAttribute('aria-label', 'Prédio do time (mapa vertical)');
    this.tela.setAttribute('aria-hidden', 'true');
    this.palco.append(this.tela, this.rotulos);
    this.camada.append(this.palco);
    this.camada.addEventListener('scroll', () => this.desenharAgora(), { passive: true });
    this.arrastarComMouse();

    const mais = el('button', 'pred-btn pred-btn--ic', '+');
    const menos = el('button', 'pred-btn pred-btn--ic', '−');
    mais.type = 'button';
    menos.type = 'button';
    mais.setAttribute('aria-label', 'Aproximar');
    menos.setAttribute('aria-label', 'Afastar');
    mais.addEventListener('click', () => this.zoomCentro(FATOR_ZOOM));
    menos.addEventListener('click', () => this.zoomCentro(1 / FATOR_ZOOM));
    this.zoom.append(mais, menos);

    this.el.append(this.camada, this.alterna, this.zoom);

    new ResizeObserver(() => this.posicionar()).observe(this.topbar);
    addEventListener('resize', () => {
      this.posicionar();
      if (!this.camada.hidden) {
        this.aplicarEscala(this.detalhe ? this.escala : this.escalaVisao());
        this.desenharAgora();
      }
    });
    document.addEventListener('visibilitychange', () => this.ligarLoop());

    this.vista = lerVista();
    this.aplicarVista();
  }

  // ------------------------------------------------------------------ vista

  private trocar(v: Vista): void {
    gravarVista(v);
    if (v === this.vista) return;
    this.vista = v;
    this.aplicarVista();
  }

  private aplicarVista(): void {
    const predio = this.vista === 'predio';
    this.bSalas.setAttribute('aria-pressed', String(!predio));
    this.bPredio.setAttribute('aria-pressed', String(predio));
    this.camada.hidden = !predio;
    this.zoom.hidden = !predio;
    if (predio) {
      this.render();
      requestAnimationFrame(() => {
        this.posicionar();
        this.aplicarEscala(this.detalhe ? this.escala : this.escalaVisao());
        this.desenharAgora();
      });
    }
    this.ligarLoop();
  }

  /** O alternador fica 8 px abaixo da barra de cima; a camada começa na base da barra. */
  private posicionar(): void {
    const base = this.ctx.root.getBoundingClientRect().top;
    const b = Math.round(this.topbar.getBoundingClientRect().bottom - base);
    this.camada.style.top = `${b}px`;
    this.alterna.style.top = `${b + 8}px`;
  }

  // ------------------------------------------------------------------ dados

  render(): void {
    let agentes = (this.ctx.store.snapshot?.agents ?? []) as unknown as AgentePredio[];
    if (this.ctx.store.mock && !agentes.some((a) => a.provider === 'hermes')) agentes = exemploPredio().agentes;
    const v = montarPredio(agentes, null);
    const agora = performance.now();
    const assinatura = JSON.stringify(v.andares);
    if (assinatura === this.assinatura && this.m) {
      this.m.bonecos.expirar(agora);
      this.reconciliarCrachas();
      return;
    }
    this.assinatura = assinatura;
    const chave = chaveCena(v);
    if (!this.m || this.m.chave !== chave) this.montar(v, chave);
    const m = this.m!;
    m.bonecos.reconciliar(v, agora);
    m.quadro.deployRodando = m.bonecos.lista.some((b) => b.o.perfil === 'deployer' && b.o.estado === 'running');
    this.atualizarPlacas(v);
    this.reconciliarCrachas();
    if (!this.camada.hidden) this.desenharAgora();
  }

  private montar(v: PredioVista, chave: string): void {
    const cena = montarCena(v, art);
    const bonecos = new Bonecos(cena, art);
    for (const c of this.crachas.values()) c.el.remove();
    this.crachas.clear();
    this.rotulos.replaceChildren();
    const placasAndar = cena.andares.map((a) => {
      const b = el('button', 'pred-andar');
      b.type = 'button';
      const resumo = el('span', 'pred-andar__n');
      b.append(el('span', 'pred-andar__tit', a.titulo), resumo);
      this.rotulos.append(b);
      return { a, el: b, resumo };
    });
    const nomes = new Map(v.andares.flatMap((a) => a.salas).map((s) => [`sala:${s.id}`, s.nome]));
    const placasSala: Montada['placasSala'] = [];
    for (const a of cena.andares)
      for (const ar of a.areas) {
        let nome = nomes.get(ar.id) ?? null;
        if (ar.id.endsWith(':copa')) nome = 'Copa';
        else if (ar.id.endsWith(':terraco')) nome = 'Terraço';
        else if (ar.id.endsWith(':recepcao')) nome = 'Recepção';
        if (!nome) continue;
        const e = el('span', 'pred-sala', nome);
        this.rotulos.append(e);
        placasSala.push({ area: ar, el: e });
      }
    this.m = {
      chave,
      cena,
      pf: new PathFinder(cena.grid),
      bonecos,
      quadro: { cena, vis: areasVis(art, cena), bonecos: bonecos.lista, porMesa: bonecos.porMesa, deployRodando: false },
      placasAndar,
      placasSala,
    };
    this.aplicarEscala(this.detalhe ? this.escala : this.escalaVisao());
  }

  private atualizarPlacas(v: PredioVista): void {
    for (const p of this.m!.placasAndar) {
      const gente = v.andares.find((x) => x.id === p.a.id)?.salas.flatMap((s) => s.ocupantes) ?? [];
      const trab = gente.filter((o) => o.estado === 'running').length;
      const mao = gente.filter((o) => o.estado === 'blocked').length;
      const resumo =
        p.a.id === 'terreo'
          ? `${gente.filter((o) => o.estado === 'conversando').length} conversando`
          : p.a.id === 'cobertura'
            ? v.portoes
              ? `✋ ${v.portoes} ${v.portoes === 1 ? 'portão' : 'portões'}`
              : 'nada esperando'
            : `${trab} trabalhando${mao ? ` · ✋ ${mao}` : ''}`;
      p.resumo.textContent = resumo;
      p.resumo.classList.toggle('pred-andar__n--mao', p.a.id === 'cobertura' && v.portoes > 0);
      p.el.setAttribute('aria-label', `${p.a.titulo}: ${resumo}`);
    }
  }

  /** Um crachá por boneco: cria quem chegou, refaz quem mudou (estado, nome, selo), tira quem saiu. */
  private reconciliarCrachas(): void {
    const lista = this.m?.bonecos.lista ?? [];
    const vivos = new Set<string>();
    for (const b of lista) {
      vivos.add(b.id);
      const assinatura = JSON.stringify([b.o.nome, b.o.estado, b.o.modelo, b.o.detalhe]);
      const c = this.crachas.get(b.id);
      if (c && c.assinatura === assinatura) {
        c.b = b;
        continue;
      }
      const novo = criarCracha(b, assinatura);
      if (c) c.el.replaceWith(novo.el);
      else this.rotulos.append(novo.el);
      this.crachas.set(b.id, novo);
    }
    for (const [id, c] of this.crachas)
      if (!vivos.has(id)) {
        c.el.remove();
        this.crachas.delete(id);
      }
  }

  // ------------------------------------------------------------------ câmera

  private escalaVisao(): number {
    return Math.max(0.5, Math.min(1.5, this.camada.clientWidth / WPX));
  }
  private largPalco(): number {
    return Math.max(this.camada.clientWidth, Math.round(WPX * this.escala));
  }
  private offX(): number {
    return Math.round((this.largPalco() - WPX * this.escala) / 2);
  }

  private aplicarEscala(s: number): void {
    this.escala = s;
    const h = (this.m?.cena.alturaT ?? 0) * TILE;
    this.palco.style.width = `${this.largPalco()}px`;
    this.palco.style.height = `${Math.round(h * s)}px`;
    this.camada.classList.toggle('pred-camada--detalhe', this.detalhe);
    this.posicionarPlacas();
  }

  /** + e − em volta do centro da tela, entre a visão geral e ESCALA_MAX (D3). */
  private zoomCentro(f: number): void {
    const W = this.camada.clientWidth;
    const H = this.camada.clientHeight;
    const wx = (this.camada.scrollLeft + W / 2 - this.offX()) / this.escala;
    const wy = (this.camada.scrollTop + H / 2) / this.escala;
    const ev = this.escalaVisao();
    const alvo = Math.max(ev, Math.min(ESCALA_MAX, this.escala * f));
    this.detalhe = alvo > ev * 1.4;
    this.zoomPara(alvo, wx, wy, W / 2, H / 2, 260);
  }

  /** Zoom com âncora: o ponto de mundo (wx, wy) fica sob o ponto de tela (sx, sy). */
  private zoomPara(alvo: number, wx: number, wy: number, sx: number, sy: number, ms: number): void {
    const ini = this.escala;
    const t0 = performance.now();
    const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const passo = (agora: number) => {
      const u = reduz ? 1 : Math.min(1, (agora - t0) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      this.aplicarEscala(ini + (alvo - ini) * e);
      this.camada.scrollLeft = this.offX() + wx * this.escala - sx;
      this.camada.scrollTop = wy * this.escala - sy;
      this.desenharAgora();
      if (u < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  private arrastarComMouse(): void {
    // no toque, a rolagem nativa já faz
    let arr: { x: number; y: number; sl: number; st: number } | null = null;
    this.camada.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button')) return;
      arr = { x: e.clientX, y: e.clientY, sl: this.camada.scrollLeft, st: this.camada.scrollTop };
    });
    addEventListener('pointermove', (e) => {
      if (!arr) return;
      this.camada.scrollLeft = arr.sl - (e.clientX - arr.x);
      this.camada.scrollTop = arr.st - (e.clientY - arr.y);
    });
    addEventListener('pointerup', () => (arr = null));
  }

  // ------------------------------------------------------------------ loop e desenho

  /** Loop só com o Prédio ativo e a aba visível (D9). */
  private ligarLoop(): void {
    const ativo = this.vista === 'predio' && !document.hidden;
    if (!ativo) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    if (this.raf) return;
    this.ultimo = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private readonly loop = (agora: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const m = this.m;
    if (!m) return;
    const dt = Math.min(0.1, (agora - this.ultimo) / 1000);
    this.ultimo = agora;
    m.bonecos.passo(dt, agora, m.pf, this.rnd);
    // Quem sumiu há > 3 s sai mesmo se o servidor parar de mandar snapshot.
    if (agora - this.ultExpirar >= 1000) {
      this.ultExpirar = agora;
      const n = m.bonecos.lista.length;
      m.bonecos.expirar(agora);
      if (m.bonecos.lista.length !== n) this.reconciliarCrachas();
    }
    if (agora - this.ultDesenho < FPS_MS) return;
    this.desenharAgora(agora);
  };

  private desenharAgora(agora = performance.now()): void {
    const m = this.m;
    if (!m || this.camada.hidden) return;
    this.ultDesenho = agora;
    const W = this.camada.clientWidth;
    const H = this.camada.clientHeight;
    if (!W || !H) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (this.tela.width !== Math.round(W * d) || this.tela.height !== Math.round(H * d)) {
      this.tela.width = Math.round(W * d);
      this.tela.height = Math.round(H * d);
      this.tela.style.width = `${W}px`;
      this.tela.style.height = `${H}px`;
    }
    const ctx = this.tela.getContext('2d', { alpha: false });
    if (!ctx) return;
    desenhar(ctx, art, m.quadro, { escala: this.escala, ox: this.offX(), scrollLeft: this.camada.scrollLeft, scrollTop: this.camada.scrollTop, W, H, dpr: d }, agora);
    this.posicionarPlacas();
    this.posicionarCrachas();
  }

  /** Placas dos andares (acompanham a rolagem lateral) e nomes das salas (na face da parede). */
  private posicionarPlacas(): void {
    const m = this.m;
    if (!m) return;
    const ox = this.offX();
    const s = this.escala;
    for (const p of m.placasAndar) {
      p.el.style.left = `${Math.round(Math.max(ox + BX * TILE * s + 4, this.camada.scrollLeft + 8))}px`;
      p.el.style.top = `${Math.round(p.a.y0 * TILE * s + (LAJE * TILE * s) / 2)}px`;
    }
    for (const p of m.placasSala) {
      p.el.style.left = `${Math.round(ox + (p.area.rect.x + 1) * TILE * s)}px`;
      p.el.style.top = `${Math.round((p.area.rect.y + p.area.rect.h - 1.6) * TILE * s)}px`;
    }
  }

  /** Crachá simples: centrado acima da cabeça, preso dentro da cena (o desvio de móvel chega na S7). */
  private posicionarCrachas(): void {
    const ox = this.offX();
    const s = this.escala;
    const st = this.camada.scrollTop;
    const H = this.camada.clientHeight;
    const min = Math.max(ox, this.camada.scrollLeft) + 4;
    const max = Math.min(ox + WPX * s, this.camada.scrollLeft + this.camada.clientWidth) - 4;
    for (const c of this.crachas.values()) {
      const b = c.b;
      const sy = b.head.y * s;
      if (!b.head.ok || sy < st - 60 || sy > st + H + 60) {
        c.el.style.visibility = 'hidden';
        continue;
      }
      c.el.style.visibility = 'visible';
      const w = c.el.offsetWidth;
      const h = c.el.offsetHeight;
      const x = Math.round(Math.max(min, Math.min(ox + b.head.x * s - w / 2, max - w)));
      const y = Math.round(sy - h - 4 - (b.icone ? 6 : 0));
      c.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}

function criarCracha(b: Boneco, assinatura: string): Cracha {
  const o = b.o;
  const r = el('div', `pred-rot pred-rot--${o.estado}`);
  const nome = el('span', 'pred-rot__nome');
  nome.append(el('i', 'pred-dot'), el('span', '', nomeCurto(o)));
  r.append(nome);
  if (o.modelo) {
    const sel = seloModelo(o.modelo);
    const s = el('span', `ui-hsel ui-hsel--${sel.variante} pred-selo`, sel.texto);
    s.title = sel.titulo;
    r.append(s);
  } else if (o.perfil === 'victor' && o.estado === 'blocked') r.append(el('span', 'pred-selo pred-selo--portao', 'portão'));
  const estado = o.perfil === 'victor' ? (o.estado === 'blocked' ? 'precisa de você' : 'nada esperando') : ROTULO_ESTADO[o.estado];
  r.append(el('span', 'pred-rot__est', estado));
  r.title = [o.nome, ROTULO_ESTADO[o.estado], o.detalhe].filter(Boolean).join(' · ');
  return { b, el: r, assinatura };
}
