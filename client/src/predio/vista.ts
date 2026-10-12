// Vista Prédio (specs/predio-vertical.md, D1, D3 e D9; fatia S6): o botão "Salas | Prédio" logo abaixo da barra de
// cima (lembrado em localStorage['escritorio.vista']; ?vista= na URL vence) e, no Prédio, a camada com o mapinha
// vertical do time: andares empilhados, coluna do elevador à direita, placas dos andares, nomes das salas e o crachá
// (nome + selo) acima de cada boneco, com + e − de zoom. Salas ativa = camada escondida e loop parado.
// Dados: montarPredio(snapshot.agents, null); no ?mock=1 sem agentes do Hermes, exemploPredio().agentes.
// S7: tocar no andar/placa enquadra sem corte (D3, ?andar= e &sala=), crachás desviando de móvel, placa e outro
// crachá (D4; abreviados quando não há lugar) e window.__predio (D10). (S8): viagens.
import * as artModule from '../art';
import { TILE } from '../art/api';
import type { UiComponent, UiContext } from '../ui/context';
import { seloModelo } from '../ui/hermes-selo';
import { exemploPredio, montarPredio, ROTULO_ESTADO, type AgentePredio, type AndarId, type Ocupante, type PredioVista } from '../ui/predio-model';
import type { AreaLayout } from '../world/layout/types';
import { PathFinder } from '../world/path/astar';
import { furnitureSprites, opaqueBounds } from '../world/render/scene';
import { Bonecos, type Boneco } from './bonecos';
import { BUSCA_MAX, posicionarCrachas, sobrepoe, type ItemCracha } from './crachas';
import { andarEm, enquadrarRet, ESCALA_MAX, escalaVisao, LARGO_PX, ladoDireito, MARGEM, retAndar, retSala, retSalaPorId, type Ret } from './enquadrar';
import { BX, LAJE, montarCena, POCO_W, POCO_X, WT, type AndarCena, type Cena } from './planta';
import { areasVis, desenhar, type ArtPredio, type Quadro } from './render';

const art: ArtPredio = artModule;
const CHAVE = 'escritorio.vista';
type Vista = 'salas' | 'predio';
/** Desenho a 12 quadros/s (a simulação anda a cada quadro). */
const FPS_MS = 1000 / 12;
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
  nome: HTMLElement;
  assinatura: string;
  /** Tamanho do crachá inteiro (nome, selo e, com zoom, o estado); medido sem a classe --curto. */
  cheio?: { w: number; h: number };
  curto: boolean;
}

interface Montada {
  chave: string;
  cena: Cena;
  quadro: Quadro;
  pf: PathFinder;
  bonecos: Bonecos;
  placasAndar: { a: AndarCena; el: HTMLButtonElement; resumo: HTMLElement }[];
  placasSala: { area: AreaLayout; el: HTMLElement }[];
  /** Móveis (parte opaca do sprite base e do `front`) e a cabine, em px de mundo: obstáculos dos crachás. */
  moveis: Ret[];
}

/** Gancho de verificação (D10), só com ?mock=1 ou ?debug=1. */
interface GanchoPredio {
  vista(): Vista;
  escala(): number;
  enquadramento(): { salaOuAndar: string; esquerda: number; direita: number; larguraTela: number } | null;
  medirCrachas(): { total: number; sobreMovel: number; cortados: number; sobreCrachaOuPlaca: number; abreviados: number };
  elevador(): { posicao: number; porta: number; carga: string[]; filas: Record<AndarId, string[]> };
  viagens(): { pendentes: number; andando: number; feitas: number; resolvidasSemAnimacao: number };
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
  private margem = { l: 0, r: 0 };
  private detalhe = false;
  /** O que o último toque (ou ?andar=) enquadrou; some com + e −. */
  private alvo: { nome: string; ret: Ret } | null = null;
  private arrastou = false;
  private urlAplicada = false;
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
    this.camada.addEventListener('click', (e) => this.tocar(e));
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

    // alternador primeiro no DOM: vem antes das placas na ordem do Tab
    this.el.append(this.alterna, this.camada, this.zoom);

    new ResizeObserver(() => this.posicionar()).observe(this.topbar);
    addEventListener('resize', () => {
      this.posicionar();
      if (!this.camada.hidden) {
        this.aplicarEscala(this.detalhe ? this.escala : this.escalaVisao());
        this.desenharAgora();
      }
    });
    document.addEventListener('visibilitychange', () => this.ligarLoop());
    // A área livre muda quando a lista lateral ou a gaveta abrem/fecham (--free-* no root).
    new MutationObserver(() => {
      if (this.camada.hidden) return;
      const { l, r } = this.margem;
      const ev = this.escalaVisao();
      if (l === this.margem.l && r === this.margem.r) return;
      this.aplicarEscala(this.detalhe ? this.escala : ev);
      this.desenharAgora();
    }).observe(this.ctx.root, { attributes: true, attributeFilter: ['style'] });

    this.vista = lerVista();
    this.aplicarVista();
    const q = new URLSearchParams(location.search);
    if (q.has('mock') || q.has('debug')) (window as unknown as { __predio: GanchoPredio }).__predio = this.gancho();
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
        this.aplicarUrl();
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
    const vis = areasVis(art, cena);
    const moveis: Ret[] = [];
    for (const a of vis)
      for (const f of a.furniture) {
        const fs = furnitureSprites(art, f, 0);
        for (const sp of [fs?.base, fs?.front]) {
          if (!sp) continue;
          const ob = opaqueBounds(sp.canvas);
          if (ob.w > 0 && ob.h > 0) moveis.push({ x: Math.round(f.ax - sp.ax) + ob.x, y: Math.round(f.ay - sp.ay) + ob.y, w: ob.w, h: ob.h });
        }
      }
    // cabine (parada no Térreo até a S8)
    moveis.push({ x: POCO_X * TILE, y: (cena.paradas.terreo.cy + 1) * TILE, w: POCO_W * TILE, h: 2 * TILE });
    this.m = {
      chave,
      cena,
      pf: new PathFinder(cena.grid),
      bonecos,
      quadro: { cena, vis, bonecos: bonecos.lista, porMesa: bonecos.porMesa, deployRodando: false },
      placasAndar,
      placasSala,
      moveis,
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

  /** Margens laterais da área livre (--free-left/--free-right, as mesmas que as Salas usam). */
  private livre(): { l: number; r: number } {
    const cs = getComputedStyle(this.ctx.root);
    const px = (n: string) => Math.max(0, parseFloat(cs.getPropertyValue(n)) || 0);
    const l = px('--free-left');
    const r = px('--free-right');
    this.margem = l + r < this.camada.clientWidth - 80 ? { l, r } : { l: 0, r: 0 };
    return this.margem;
  }
  private escalaVisao(): number {
    return escalaVisao(this.camada.clientWidth, this.livre());
  }
  private largPalco(s = this.escala): number {
    const { l, r } = this.margem;
    return Math.max(this.camada.clientWidth, Math.round(WPX * s) + l + r);
  }
  /** O prédio fica centrado na área livre (fora da lista lateral e da gaveta). */
  private offX(s = this.escala): number {
    const { l, r } = this.margem;
    return l + Math.round((this.largPalco(s) - l - r - WPX * s) / 2);
  }

  private aplicarEscala(s: number): void {
    this.livre();
    this.escala = s;
    const h = (this.m?.cena.alturaT ?? 0) * TILE;
    this.palco.style.width = `${this.largPalco()}px`;
    this.palco.style.height = `${Math.round(h * s)}px`;
    if (this.camada.classList.contains('pred-camada--detalhe') !== this.detalhe) {
      for (const c of this.crachas.values()) c.cheio = undefined; // o estado aparece/some: medir de novo
      this.camada.classList.toggle('pred-camada--detalhe', this.detalhe);
    }
    this.posicionarPlacas();
  }

  /** + e − em volta do centro da área livre (fora da lista e da gaveta), entre a visão geral e ESCALA_MAX (D3). */
  private zoomCentro(f: number): void {
    const { l, r } = this.livre();
    const W = this.camada.clientWidth;
    const H = this.camada.clientHeight;
    const sx = l + (W - l - r) / 2;
    const wx = (this.camada.scrollLeft + sx - this.offX()) / this.escala;
    const wy = (this.camada.scrollTop + H / 2) / this.escala;
    const ev = this.escalaVisao();
    const alvo = Math.max(ev, Math.min(ESCALA_MAX, this.escala * f));
    this.detalhe = alvo > ev * 1.4;
    this.alvo = null;
    this.zoomPara(alvo, wx, wy, sx, H / 2, 260);
  }

  /** Tocar no andar (ou na placa dele) aproxima (D3). Já com zoom, só a placa de um andar muda o enquadramento. */
  private tocar(e: MouseEvent): void {
    const m = this.m;
    if (!m || this.arrastou) return;
    const alvo = e.target as HTMLElement;
    const placa = m.placasAndar.find((p) => p.el === alvo.closest('.pred-andar'));
    if (!placa && alvo.closest('button')) return;
    const r = this.camada.getBoundingClientRect();
    const wx = (this.camada.scrollLeft + e.clientX - r.left - this.offX()) / this.escala;
    const wy = (this.camada.scrollTop + e.clientY - r.top) / this.escala;
    const a = placa?.a ?? andarEm(m.cena, wy);
    if (!a) return;
    if (!placa && this.escala > this.escalaVisao() * 1.05) return; // com zoom, arrasta-se para andar pela cena
    this.enquadrarAndar(a, placa ? undefined : { wx, wy });
  }

  /** Tela larga: o andar inteiro. Estreita: a sala de `salaId`, a do lado tocado ou (placa) a da esquerda do 1º bloco. */
  private enquadrarAndar(a: AndarCena, toque?: { wx: number; wy: number }, salaId?: string): void {
    const m = this.m!;
    if (this.camada.clientWidth >= LARGO_PX) return this.enquadrar(a.id, retAndar(a));
    const porId = salaId ? retSalaPorId(m.cena, salaId) : null;
    if (porId) return this.enquadrar(salaId!, porId);
    const direita = toque ? ladoDireito(toque.wx) : false;
    this.enquadrar(`${a.id}:${direita ? 'direita' : 'esquerda'}`, retSala(a, direita, toque?.wy));
  }

  /** Zoom animado (380 ms) que deixa `ret` inteiro na área livre, sem corte (enquadrarRet). */
  private enquadrar(nome: string, ret: Ret): void {
    const livre = this.livre();
    // MARGEM + 0,5 px: o navegador arredonda scrollLeft e a borda do retângulo não pode passar dos 8 px
    const e = enquadrarRet(ret, this.camada.clientWidth, this.camada.clientHeight, MARGEM + 0.5, livre, (s) => this.offX(s));
    const sx = this.offX(e.escala) + ret.x * e.escala - e.scrollLeft;
    const sy = ret.y * e.escala - e.scrollTop;
    this.detalhe = e.escala > this.escalaVisao() * 1.4;
    this.alvo = { nome, ret };
    this.zoomPara(e.escala, ret.x, ret.y, sx, sy, 380);
  }

  /** ?andar=cobertura|produto|ti|terreo abre já com zoom; &sala=<id em PLANTA> escolhe a sala no celular. */
  private aplicarUrl(): void {
    if (this.urlAplicada || !this.m) return;
    this.urlAplicada = true;
    const q = new URLSearchParams(location.search);
    const a = this.m.cena.andares.find((x) => x.id === q.get('andar'));
    if (a) this.enquadrarAndar(a, undefined, q.get('sala') ?? undefined);
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
    // no toque, a rolagem nativa já faz (e o navegador não dispara click depois de rolar)
    let arr: { x: number; y: number; sl: number; st: number } | null = null;
    this.camada.addEventListener('pointerdown', (e) => {
      this.arrastou = false;
      if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button')) return;
      arr = { x: e.clientX, y: e.clientY, sl: this.camada.scrollLeft, st: this.camada.scrollTop };
    });
    addEventListener('pointermove', (e) => {
      if (!arr) return;
      const dx = e.clientX - arr.x;
      const dy = e.clientY - arr.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.arrastou = true;
      this.camada.scrollLeft = arr.sl - dx;
      this.camada.scrollTop = arr.st - dy;
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

  /** Retângulos (px do palco) das placas de andar e dos nomes de sala, do último posicionarPlacas. */
  private retPlacas: Ret[] = [];

  /** Placas dos andares (acompanham a rolagem lateral, dentro da área livre) e nomes das salas (na face da parede). */
  private posicionarPlacas(): void {
    const m = this.m;
    if (!m) return;
    const ox = this.offX();
    const s = this.escala;
    const { l, r } = this.margem;
    const sl = this.camada.scrollLeft;
    const W = this.camada.clientWidth;
    // leituras antes das escritas (um só cálculo de layout)
    const tamAndar = m.placasAndar.map((p) => ({ w: p.el.offsetWidth, h: p.el.offsetHeight }));
    const tamSala = m.placasSala.map((p) => ({ w: p.el.offsetWidth, h: p.el.offsetHeight }));
    // o alternador fica por cima da camada: placa que cairia debaixo dele desce para logo abaixo (com zoom)
    const cr = this.camada.getBoundingClientRect();
    const ab = this.alterna.getBoundingClientRect();
    const alt: Ret = { x: ab.left - cr.left + sl, y: ab.top - cr.top + this.camada.scrollTop, w: ab.width, h: ab.height };
    const rets: Ret[] = [];
    m.placasAndar.forEach((p, i) => {
      const { w, h } = tamAndar[i]!;
      const min = sl + l + 8;
      const max = sl + W - r - 8 - w;
      const x = Math.round(Math.max(min, Math.min(Math.max(ox + BX * TILE * s + 4, min), max)));
      let y = Math.round(p.a.y0 * TILE * s + (LAJE * TILE * s) / 2);
      if (alt.w && sobrepoe({ x, y: y - h / 2, w, h }, alt) > 0) y = Math.round(alt.y + alt.h + 4 + h / 2);
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      rets.push({ x, y: y - h / 2, w, h }); // translateY(-50%)
    });
    m.placasSala.forEach((p, i) => {
      const x = Math.round(ox + (p.area.rect.x + 1) * TILE * s);
      const y = Math.round((p.area.rect.y + p.area.rect.h - 1.6) * TILE * s);
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      rets.push({ x, y, ...tamSala[i]! });
    });
    this.retPlacas = rets;
  }

  /**
   * Crachás (D4): só de quem tem a cabeça na área visível; cada um na 1ª posição que não cobre móvel, placa, nome de
   * sala, cabine, botões fixos nem outro crachá, preso dentro da área livre. Sem lugar com o crachá inteiro, ele é
   * abreviado (só o nome; o selo e o estado ficam no title) e posto de novo.
   */
  private posicionarCrachas(): void {
    const m = this.m;
    if (!m) return;
    const ox = this.offX();
    const s = this.escala;
    const sl = this.camada.scrollLeft;
    const st = this.camada.scrollTop;
    const W = this.camada.clientWidth;
    const H = this.camada.clientHeight;
    const { l, r } = this.margem;
    const vis: Ret = { x: sl + l, y: st, w: W - l - r, h: H };
    const limite: Ret = { x: vis.x + 4, y: vis.y + 4, w: vis.w - 8, h: vis.h - 8 };
    const ativos: Cracha[] = [];
    for (const c of this.crachas.values()) {
      const b = c.b;
      const hx = ox + b.head.x * s;
      const hy = b.head.y * s;
      const ok = b.head.ok && hx >= vis.x && hx <= vis.x + vis.w && hy >= vis.y && hy <= vis.y + vis.h;
      c.el.style.visibility = ok ? 'visible' : 'hidden';
      if (!ok) continue;
      ativos.push(c);
      if (!c.cheio && c.curto) {
        c.el.classList.remove('pred-rot--curto');
        c.curto = false;
      }
    }
    if (!ativos.length) return;
    // leituras (depois de todas as escritas acima)
    for (const c of ativos) c.cheio ??= { w: c.el.offsetWidth, h: c.el.offsetHeight };
    const curto = new Map(ativos.map((c) => [c.b.id, { w: c.nome.offsetWidth, h: c.nome.offsetHeight }]));
    const cr = this.camada.getBoundingClientRect();
    const perto: Ret = { x: vis.x - 80, y: vis.y - 80, w: vis.w + 160, h: vis.h + 160 };
    const obst: Ret[] = [];
    for (const mv of m.moveis) {
      const o = { x: ox + mv.x * s, y: mv.y * s, w: mv.w * s, h: mv.h * s };
      if (sobrepoe(o, perto) > 0) obst.push(o);
    }
    const duros: Ret[] = [...this.retPlacas];
    for (const e of [this.alterna, this.zoom]) {
      if (e.hidden) continue;
      const b = e.getBoundingClientRect();
      duros.push({ x: b.left - cr.left + sl, y: b.top - cr.top + st, w: b.width, h: b.height });
    }
    const itens = (abreviar: ReadonlySet<string>): ItemCracha[] =>
      ativos.map((c) => {
        const b = c.b;
        const t = abreviar.has(b.id) ? curto.get(b.id)! : c.cheio!;
        return { id: b.id, cabeca: { x: ox + b.head.x * s, y: b.head.y * s - (b.icone ? 6 : 0) }, pes: { x: ox + b.x * s, y: b.y * s }, w: t.w, h: t.h, sentado: b.seated };
      });
    let abreviar = new Set<string>();
    // 1º o crachá inteiro perto da cabeça; quem não coube é abreviado e procura o chão livre um pouco mais longe
    const busca = BUSCA_MAX * Math.min(1, s);
    let pos = posicionarCrachas(itens(abreviar), obst, limite, duros, Math.round(busca / 2));
    if (pos.some((p) => p.sobreposicao > 0)) {
      abreviar = new Set(pos.filter((p) => p.sobreposicao > 0).map((p) => p.id));
      pos = posicionarCrachas(itens(abreviar), obst, limite, duros, Math.round(busca));
    }
    for (const p of pos) {
      const c = this.crachas.get(p.id)!;
      const ab = abreviar.has(p.id);
      if (ab !== c.curto) {
        c.curto = ab;
        c.el.classList.toggle('pred-rot--curto', ab);
      }
      c.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }

  // ------------------------------------------------------------------ verificação (D10)

  private gancho(): GanchoPredio {
    const filas = (): Record<AndarId, string[]> => ({ cobertura: [], produto: [], ti: [], terreo: [] });
    return {
      vista: () => this.vista,
      escala: () => this.escala,
      enquadramento: () => {
        if (!this.alvo || this.camada.hidden) return null;
        const { ret } = this.alvo;
        const esquerda = this.offX() + ret.x * this.escala - this.camada.scrollLeft;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        return { salaOuAndar: this.alvo.nome, esquerda: r2(esquerda), direita: r2(esquerda + ret.w * this.escala), larguraTela: this.camada.clientWidth };
      },
      medirCrachas: () => this.medirCrachas(),
      // elevador e viagens chegam na S8: valores neutros (cabine parada no Térreo, porta fechada, nada andando)
      elevador: () => ({ posicao: Math.max(0, (this.m?.cena.andares.length ?? 1) - 1), porta: 0, carga: [], filas: filas() }),
      viagens: () => ({ pendentes: 0, andando: 0, feitas: 0, resolvidasSemAnimacao: 0 }),
    };
  }

  /** Medido no DOM, na tela atual: crachás visíveis, em cima de móvel, cortados (fora da área livre) etc. */
  private medirCrachas(): ReturnType<GanchoPredio['medirCrachas']> {
    const res = { total: 0, sobreMovel: 0, cortados: 0, sobreCrachaOuPlaca: 0, abreviados: 0 };
    const m = this.m;
    if (!m || this.camada.hidden) return res;
    const cr = this.camada.getBoundingClientRect();
    const W = this.camada.clientWidth;
    const H = this.camada.clientHeight;
    const { l, r } = this.margem;
    const ox = this.offX();
    const s = this.escala;
    const sl = this.camada.scrollLeft;
    const st = this.camada.scrollTop;
    const rel = (e: Element): Ret => {
      const b = e.getBoundingClientRect();
      return { x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height };
    };
    const tela: Ret = { x: 0, y: 0, w: W, h: H };
    const moveis = m.moveis.map((mv) => ({ x: ox + mv.x * s - sl, y: mv.y * s - st, w: mv.w * s, h: mv.h * s }));
    const placas = [...m.placasAndar, ...m.placasSala].map((p) => rel(p.el));
    const crachas = [...this.crachas.values()].filter((c) => c.el.style.visibility === 'visible').map((c) => ({ c, r: rel(c.el) })).filter((x) => sobrepoe(x.r, tela) > 0);
    crachas.forEach(({ c, r: a }, i) => {
      res.total++;
      if (c.curto) res.abreviados++;
      if (moveis.some((mv) => sobrepoe(a, mv) > 0)) res.sobreMovel++;
      if (a.x < l - 0.5 || a.x + a.w > W - r + 0.5 || a.y < -0.5 || a.y + a.h > H + 0.5) res.cortados++;
      if (placas.some((p) => sobrepoe(a, p) > 0) || crachas.some((o, j) => j !== i && sobrepoe(a, o.r) > 0)) res.sobreCrachaOuPlaca++;
    });
    return res;
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
  r.title = [o.nome, ROTULO_ESTADO[o.estado], o.detalhe, o.modelo ? seloModelo(o.modelo).texto : ''].filter(Boolean).join(' · ');
  return { b, el: r, nome, assinatura, curto: false };
}
