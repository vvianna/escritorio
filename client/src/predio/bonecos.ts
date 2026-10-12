// Personagens da vista Prédio (specs/predio-vertical.md, D1, D7, S6 e S8): quem senta, digita, levanta a mão, passeia
// até a copa ou conversa na Recepção, e quem muda de andar pelo elevador. Copiado e organizado do protótipo (branch
// prototipo/predio-vertical, `criarBonecos` e `passoBoneco`), reconciliando por agentId a cada render(): entra quem
// chegou, sai quem sumiu há mais de 3 s e a mesa fica estável por agente enquanto ele não muda de sala.
// S8: toda troca de andar (viagem de cartão, portão, persona e o passeio à toa) passa por hall → fila → cabine → hall;
// ninguém atravessa a laje andando. Cada boneco segue um roteiro de passos (anda, elevador, pausa, ação).
import { TILE, type ArtModule, type Appearance, type Dir, type HeldItem, type IconName, type Pose } from '../art/api';
import { hash32 } from '../../../shared/hash';
import type { AreaLayout, SpotDef } from '../world/layout/types';
import type { PathFinder } from '../world/path/astar';
import type { WalkGrid } from '../world/path/grid';
import type { AndarId, Ocupante, PredioVista } from '../ui/predio-model';
import { ElevadorPredio } from './elevador';
import type { AndarCena, Cena, Tile } from './planta';
import { rotaPredio } from './rotas';
import type { Viagem } from './viagens';

/** Quem sumiu do snapshot fica na cena por este tempo (piscadas do snapshot não fazem o boneco sumir e voltar). */
export const SUMIR_MS = 3000;
/** Quem sumiu no meio de uma viagem termina a ida e some ao entrar na cabine da volta; no máximo este tempo (D7). */
export const SUMIR_VIAGEM_MS = 60_000;
/** Parada na mesa de quem recebe o 📦 (D7). */
export const ENTREGA_MS = 1500;
/** O Manager fica na Mesa do Victor com o portão (D7). */
export const PORTAO_MS = 4000;
/** Quem recebe segura o 📦 por este tempo e volta ao estado dele. */
export const SEGURA_CAIXA_MS = 2000;
/** 📦 deixado na mesa livre ou na porta sem ninguém para buscar. */
export const CAIXA_SOLTA_MS = 10_000;
/** Chance de quem está à toa ir à copa de outro andar (pelo elevador) em vez de passear no próprio. */
const PASSEIO_FORA = 0.3;
/** px de mundo por segundo (o mesmo andar do mapa das salas). */
const SPEED = 3.2 * TILE;
/** Quem leva cartão, portão ou pedido anda com pressa (a viagem cabe numa cena de 12 s do roteiro de demonstração). */
const PRESSA = 1.6;

type Passo =
  | { k: 'anda'; andar: AndarId; tx: number; ty: number; alvo?: SpotDef }
  | { k: 'elev'; de: AndarId; para: AndarId; volta?: boolean }
  | { k: 'pausa'; ms: number; pose: Pose }
  | { k: 'faz'; f: (b: Boneco, agora: number) => void };

interface Roteiro {
  passos: Passo[];
  i: number;
  /** Viagem de cartão que este roteiro anima (ausente = passeio ou volta à mesa). */
  viagem?: Viagem;
  /** Fase do passo atual: anda/elev começaram, fim da pausa, já chamou o elevador. */
  iniciado?: boolean;
  ate?: number;
  fase?: 'vai' | 'fila' | 'cabine';
  pressa?: boolean;
  /** Ao terminar: passeio fica no lugar; os outros retomam o estado do cartão. */
  fim?: (b: Boneco, agora: number) => void;
}

export interface Boneco {
  id: string;
  o: Ocupante;
  sala: string;
  /** Andar da sala do boneco (a casa dele). */
  andar: AndarCena;
  /** Andar onde ele está agora (muda só ao sair da cabine). */
  onde: AndarId;
  ap: Appearance;
  seed: number;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  held: HeldItem;
  seated: boolean;
  icone?: IconName;
  mesa?: SpotDef;
  alvo?: SpotDef;
  path: number[];
  pi: number;
  esperaAte: number;
  modo: 'mesa' | 'passeia' | 'entrega' | 'fixo';
  /** Topo da cabeça em px de mundo, do último quadro desenhado (para o crachá). */
  head: { x: number; y: number; ok: boolean };
  /** Quando deixou de aparecer no snapshot (ms); ausente = está no snapshot. */
  sumiuEm?: number;
  /** Roteiro em andamento (viagem, passeio noutro andar, volta à mesa). */
  rot?: Roteiro;
  /** Dentro da cabine: não é desenhado no andar (a cabine desenha os passageiros recortados). */
  dentro?: boolean;
  /** Recebeu o 📦: segura até este instante e volta ao estado dele. */
  caixaAte?: number;
}

/** 📦 fora das mãos: na porta do elevador, na cabine (passageiro `caixa:<chave>`) ou sobre a mesa livre. */
export interface Caixa {
  id: string;
  x: number;
  y: number;
  onde: AndarId;
  dentro: boolean;
  /** Some neste instante (ms); ausente = espera a cabine ou quem busca. */
  ate?: number;
  viagem: Viagem;
  /** Andar de destino (só enquanto viaja). */
  para?: AndarId;
}

const PASSEIO = new Set(['coffee', 'water', 'talk', 'window', 'cafe_seat', 'snack', 'bench', 'armchair', 'whiteboard', 'fridge']);
const RECEPCAO = new Set(['talk', 'bench', 'armchair', 'water', 'elevator']);
// espalha: N esquerda, N direita, S meio, N meio, S esquerda, S direita (crachás não se cobrem)
const ORDEM_MESA = ['N0', 'N2', 'S1', 'N1', 'S0', 'S2'];

const centro = (t: Tile) => ({ x: t.tx * TILE + TILE / 2, y: t.ty * TILE + 11 });

export class Bonecos {
  readonly lista: Boneco[] = [];
  /** Mesa (id do spot) → quem senta nela, para a tela do monitor. */
  readonly porMesa = new Map<string, Boneco>();
  readonly caixas: Caixa[] = [];
  readonly elevador: ElevadorPredio;
  /** A viagem está feita: quem viaja (ou o 📦) saiu da cabine no andar de destino (animada = true); ou foi encerrada
   *  sem animação (resolverTudo, quem sumiu). Depois disso o boneco ainda entrega e volta para casa. */
  aoTerminar?: (v: Viagem, animada: boolean) => void;
  private readonly porId = new Map<string, Boneco>();
  private readonly ocupados = new Set<string>();
  /** Quem anda até a fila de cada andar e ainda não chamou o elevador (ordem de saída). */
  private readonly indo = new Map<AndarId, string[]>();
  private agora = 0;

  constructor(
    private readonly cena: Cena,
    private readonly art: Pick<ArtModule, 'appearanceFromSeed'>,
  ) {
    this.elevador = new ElevadorPredio(cena.andares.length);
  }

  /** Índice do andar no elevador (0 = Cobertura … n-1 = Térreo). */
  indice(id: AndarId): number {
    return this.cena.andares.findIndex((a) => a.id === id);
  }

  /** Põe a cena em dia com a vista: entra quem chegou, atualiza quem mudou e marca quem sumiu. */
  reconciliar(v: PredioVista, agora: number): void {
    this.agora = agora;
    const vistos = new Set<string>();
    for (const andar of v.andares) {
      const ac = this.cena.andares.find((a) => a.id === andar.id);
      if (!ac) continue;
      for (const s of andar.salas) {
        s.ocupantes.forEach((o, k) => {
          const id = o.agentId ?? `${s.id}:${o.perfil}:${k}`;
          if (vistos.has(id)) return;
          vistos.add(id);
          const area = this.cena.salaDe.get(s.id);
          let b = this.porId.get(id);
          if (!b) {
            const seed = hash32(id);
            b = { id, o, sala: s.id, andar: ac, onde: ac.id, ap: this.art.appearanceFromSeed(seed), seed, x: 0, y: 0, dir: 'down', pose: 'stand', held: 'none', seated: false, path: [], pi: 0, esperaAte: 0, modo: 'fixo', head: { x: 0, y: 0, ok: false } };
            this.porId.set(id, b);
            this.lista.push(b);
            this.configurar(b, area, k, true);
            return;
          }
          b.sumiuEm = undefined;
          const mudouSala = b.sala !== s.id;
          const mudouEstado = b.o.estado !== o.estado || b.o.perfil !== o.perfil;
          b.o = o;
          if (!mudouSala && !mudouEstado) return;
          if (mudouSala) this.soltarMesa(b);
          b.sala = s.id;
          b.andar = ac;
          // durante a viagem ele ignora o estado do cartão; ao voltar, retoma o estado atual (D7)
          if (b.rot) return;
          this.configurar(b, area, k, mudouSala);
        });
      }
    }
    for (const b of this.lista) if (!vistos.has(b.id)) b.sumiuEm ??= agora;
    this.expirar(agora);
  }

  /** Tira da cena quem sumiu do snapshot há mais de SUMIR_MS (no meio de uma viagem, SUMIR_VIAGEM_MS). */
  expirar(agora: number): void {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const b = this.lista[i]!;
      if (b.sumiuEm === undefined || agora - b.sumiuEm <= (b.rot ? SUMIR_VIAGEM_MS : SUMIR_MS)) continue;
      this.remover(b);
    }
  }

  passo(dt: number, agora: number, pf: PathFinder, rnd: () => number): void {
    this.agora = agora;
    for (const e of this.elevador.tick(dt * 1000)) {
      if (e.tipo === 'embarcou') this.embarcou(e.id);
      else if (e.tipo === 'desembarcou') this.desembarcou(e.id, e.andar, agora);
    }
    for (const b of [...this.lista]) this.passoBoneco(b, dt, agora, pf, rnd);
    for (let i = this.caixas.length - 1; i >= 0; i--) {
      const c = this.caixas[i]!;
      if (c.ate !== undefined && agora >= c.ate) this.caixas.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ viagens (D7)

  /** Quem faz a viagem está no meio de outro roteiro (viagem, passeio, fila ou cabine): ela espera (pendente). */
  ocupado(v: Viagem): boolean {
    const b = v.quem ? this.achar(v.quem) : undefined;
    return !!b && (!!b.rot || !!b.dentro);
  }

  /** Começa a viagem animada. false = não dá para animar (quem não está na cena, sem caminho): resolver na hora. */
  iniciar(v: Viagem, agora: number): boolean {
    this.agora = agora;
    if (v.tipo === 'entrega' && v.quem === null) return this.iniciarCaixa(v);
    const b = v.quem ? this.achar(v.quem) : undefined;
    if (!b || b.dentro) return false;
    const destino = v.tipo === 'portao' ? this.lista.find((x) => x.o.perfil === 'victor') : v.destino ? this.porId.get(v.destino) : undefined;
    const salaQ = v.tipo === 'portao' ? this.cena.salaDe.get('victor') : this.areaDoPerfil(v.paraPerfil);
    const mesaLivre = !destino?.mesa && salaQ ? salaQ.spots.find((s) => s.kind === 'desk' && !this.ocupados.has(s.id)) : undefined;
    const mesaAlvo = destino?.mesa ?? mesaLivre;
    const andarQ = this.cena.andares.find((a) => a.id === v.para);
    if (!mesaAlvo || !andarQ) return false;
    const entrega = this.pontoEntrega(mesaAlvo, andarQ);
    const ida = this.rota(b, v.para, entrega);
    if (!ida) return false;
    const segura: HeldItem = v.tipo === 'portao' ? 'papers' : 'box';
    const passos: Passo[] = [
      ...ida,
      { k: 'faz', f: (x) => (x.dir = mesaAlvo.y < x.y ? 'up' : 'down') },
      { k: 'pausa', ms: v.tipo === 'portao' ? PORTAO_MS : ENTREGA_MS, pose: v.tipo === 'portao' ? 'talk' : 'stand' },
      {
        k: 'faz',
        f: (x, t) => {
          x.held = 'none';
          x.icone = undefined;
          if (v.tipo !== 'portao') {
            if (destino && destino.mesa) this.darCaixa(destino, t);
            else this.caixas.push({ id: `mesa:${v.chave}`, x: mesaAlvo.x, y: mesaAlvo.y - 10, onde: v.para, dentro: false, ate: t + CAIXA_SOLTA_MS, viagem: v });
          }
          if (x.rot?.viagem) this.chegouViagem(x);
        },
      },
    ];
    // volta: à mesa (ou à Recepção, a persona); quem sumiu do snapshot some ao entrar na cabine da volta
    const casa = this.lugarDeCasa(b);
    if (v.para !== b.andar.id) passos.push({ k: 'elev', de: v.para, para: b.andar.id, volta: true });
    passos.push({ k: 'anda', andar: b.andar.id, tx: casa.tx, ty: casa.ty });
    this.comecar(b, { passos, i: 0, viagem: v, pressa: true });
    b.held = segura;
    b.icone = segura === 'box' ? 'box' : undefined;
    return true;
  }

  /**
   * Pula a animação de quem estava andando e de quem estava na cabine (aba volta, troca para o Prédio, cena nova):
   * todos em casa, cabine onde estava com a porta fechada, 📦 entregues. Devolve as viagens que não terminaram.
   */
  resolverTudo(): Viagem[] {
    const abertas: Viagem[] = [];
    this.elevador.resolverTudo();
    this.indo.clear();
    for (const c of this.caixas) if (c.para) abertas.push(c.viagem);
    this.caixas.length = 0;
    for (const b of [...this.lista]) {
      if (!b.rot) continue;
      if (b.rot.viagem) abertas.push(b.rot.viagem);
      b.rot = undefined;
      b.dentro = false;
      if (b.sumiuEm !== undefined) {
        this.remover(b);
        continue;
      }
      b.onde = b.andar.id;
      this.configurar(b, this.cena.salaDe.get(b.sala), 0, true);
    }
    for (const v of abertas) this.aoTerminar?.(v, false);
    return abertas;
  }

  /** 📦 de mão em mão (quem = null): aparece na porta do andar X e viaja sozinho na cabine até o andar Y. */
  private iniciarCaixa(v: Extract<Viagem, { tipo: 'entrega' }>): boolean {
    const p = this.cena.paradas[v.de];
    if (!p || !this.cena.paradas[v.para]) return false;
    const id = `caixa:${v.chave}`;
    const { x, y } = centro(p.porta);
    this.caixas.push({ id, x, y, onde: v.de, dentro: false, viagem: v, para: v.para });
    this.elevador.chamar(id, this.indice(v.de), this.indice(v.para));
    return true;
  }

  /** A caixa chegou ao andar Y: o `destino` (ou o mais perto na sala de Q) vai buscar; sem ninguém, fica 10 s. */
  private caixaChegou(c: Caixa, andar: AndarId, agora: number): void {
    const v = c.viagem as Extract<Viagem, { tipo: 'entrega' }>;
    const porta = this.cena.paradas[andar]!.porta;
    Object.assign(c, { ...centro(porta), onde: andar, dentro: false, para: undefined });
    this.aoTerminar?.(v, true);
    const naSala = this.lista.filter((b) => b.sala === this.salaDoPerfil(v.paraPerfil) && !b.rot && b.sumiuEm === undefined && b.onde === andar);
    const quem = (v.destino ? naSala.find((b) => b.id === v.destino) : undefined) ?? naSala.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    if (!quem) {
      c.ate = agora + CAIXA_SOLTA_MS;
      return;
    }
    const casa = this.lugarDeCasa(quem);
    this.comecar(quem, {
      passos: [
        { k: 'anda', andar, tx: porta.tx, ty: porta.ty },
        {
          k: 'faz',
          f: () => {
            const i = this.caixas.indexOf(c);
            if (i >= 0) this.caixas.splice(i, 1);
            quem.held = 'box';
            quem.icone = 'box';
          },
        },
        { k: 'anda', andar, tx: casa.tx, ty: casa.ty },
        { k: 'faz', f: (b, t) => this.darCaixa(b, t) },
      ],
      i: 0,
    });
    c.ate = agora + 60_000; // se o caminho falhar, a caixa não fica para sempre
  }

  private darCaixa(b: Boneco, agora: number): void {
    b.caixaAte = agora + SEGURA_CAIXA_MS;
    b.held = 'box';
    b.icone = 'box';
  }

  private embarcou(id: string): void {
    const c = this.caixas.find((x) => x.id === id);
    if (c) {
      c.dentro = true;
      return;
    }
    const b = this.porId.get(id);
    if (!b?.rot) return;
    b.dentro = true;
    b.path = [];
    b.pi = 0;
    b.rot.fase = 'cabine';
    const p = b.rot.passos[b.rot.i];
    // quem já saiu do snapshot some ao entrar na cabine da volta (a porta fecha com ele)
    if (p?.k === 'elev' && p.volta && b.sumiuEm !== undefined) this.remover(b);
  }

  private desembarcou(id: string, andarIdx: number, agora: number): void {
    const andar = this.cena.andares[andarIdx]?.id;
    if (!andar) return;
    const c = this.caixas.find((x) => x.id === id);
    if (c) return this.caixaChegou(c, andar, agora);
    const b = this.porId.get(id);
    if (!b) return;
    b.dentro = false;
    b.onde = andar;
    Object.assign(b, centro(this.cena.paradas[andar]!.porta));
    b.dir = 'left';
    const p = b.rot?.passos[b.rot.i];
    // saiu da cabine no andar de destino: a viagem está feita (o resto é entregar e voltar)
    if (b.rot?.viagem && p?.k === 'elev' && !p.volta) this.chegouViagem(b);
    if (b.rot) this.proximo(b, agora);
  }

  private chegouViagem(b: Boneco): void {
    const v = b.rot!.viagem!;
    b.rot!.viagem = undefined;
    this.aoTerminar?.(v, true);
  }

  // ------------------------------------------------------------------ roteiros

  private comecar(b: Boneco, r: Roteiro): void {
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    b.alvo = undefined;
    b.path = [];
    b.pi = 0;
    b.seated = false;
    b.modo = 'passeia';
    b.pose = 'stand';
    b.caixaAte = undefined;
    b.rot = r;
  }

  /**
   * Passos para ir de onde o boneco está até `tile` no andar `andar` (rotaPredio, S rotas): no mesmo andar, anda
   * direto; noutro, hall → fila → cabine → hall do andar novo → anda. null = sem caminho.
   */
  private rota(b: Boneco, andar: AndarId, tile: Tile, alvo?: SpotDef): Passo[] | null {
    const g = this.cena.grid;
    const atual = this.tileDe(b, g);
    if (!atual) return null;
    try {
      const r = rotaPredio(this.cena, { andar: b.onde, tile: atual }, { andar, tile });
      const passos: Passo[] = [];
      for (const e of r.etapas) {
        // o 1º trecho até a porta é o passo do elevador (ele anda até o fim da fila)
        if (e.tipo === 'embarque') passos.push({ k: 'elev', de: e.andar, para: andar });
        else if (e.tipo === 'andar' && e.andar === andar) passos.push({ k: 'anda', andar, tx: tile.tx, ty: tile.ty, alvo });
      }
      return passos;
    } catch {
      return null;
    }
  }

  private tileDe(b: Boneco, g: WalkGrid): Tile | null {
    const tx = Math.floor(b.x / TILE);
    const ty = Math.floor((b.y - 4) / TILE);
    if (g.walkable(tx, ty)) return { tx, ty };
    const n = g.nearestWalkable(tx, ty, 3);
    return n ? { tx: n.x, ty: n.y } : null;
  }

  private proximo(b: Boneco, agora: number): void {
    const r = b.rot!;
    r.i++;
    r.iniciado = false;
    r.fase = undefined;
    r.ate = undefined;
    if (r.i < r.passos.length) return;
    b.rot = undefined;
    b.path = [];
    b.pi = 0;
    if (r.viagem) {
      // terminou sem entregar (não devia acontecer): conta como encerrada
      this.aoTerminar?.(r.viagem, false);
    }
    if (r.fim) r.fim(b, agora);
    else this.configurar(b, this.cena.salaDe.get(b.sala), 0, false);
  }

  private passoRoteiro(b: Boneco, dt: number, agora: number, pf: PathFinder): void {
    const r = b.rot!;
    const p = r.passos[r.i];
    if (!p) return this.proximo(b, agora);
    const vel = r.pressa ? PRESSA : 1;
    switch (p.k) {
      case 'faz':
        p.f(b, agora);
        if (b.rot === r) this.proximo(b, agora);
        return;
      case 'pausa':
        if (r.ate === undefined) {
          r.ate = agora + p.ms;
          b.pose = p.pose;
        }
        if (agora >= r.ate) this.proximo(b, agora);
        return;
      case 'anda':
        if (!r.iniciado) {
          r.iniciado = true;
          b.alvo = p.alvo;
          if (!this.irPara(b, pf, this.cena.grid, p.tx, p.ty)) {
            this.chegou(b, agora, p.alvo);
            return this.proximo(b, agora);
          }
        }
        if (this.andar(b, dt * vel)) {
          this.chegou(b, agora, p.alvo);
          this.proximo(b, agora);
        }
        return;
      case 'elev':
        return this.passoElevador(b, p, r, dt * vel, pf);
    }
  }

  /** Anda até o fim da fila do andar, chama a cabine, avança na fila; o embarque/desembarque vem dos eventos. */
  private passoElevador(b: Boneco, p: Extract<Passo, { k: 'elev' }>, r: Roteiro, dt: number, pf: PathFinder): void {
    if (r.fase === 'cabine') return;
    const de = this.indice(p.de);
    const fila = this.cena.paradas[p.de]!.fila;
    const indo = this.indo.get(p.de) ?? [];
    this.indo.set(p.de, indo);
    if (!r.fase) {
      r.fase = 'vai';
      indo.push(b.id);
    }
    const naFila = this.elevador.fila(de);
    const pos = r.fase === 'fila' ? naFila.indexOf(b.id) : naFila.length + indo.indexOf(b.id);
    if (pos < 0) return; // embarcando (o evento chega no próximo tick)
    const vaga = fila[Math.min(pos, fila.length - 1)]!;
    const andando = b.pi < b.path.length;
    if (andando) {
      if (!this.andar(b, dt)) return;
    }
    const t = this.tileDe(b, this.cena.grid);
    const naVaga = t && t.tx === vaga.tx && t.ty === vaga.ty;
    if (!naVaga && !andando && this.irPara(b, pf, this.cena.grid, vaga.tx, vaga.ty)) return;
    // chegou à vaga (ou não há caminho até ela): espera virado para a porta
    b.pose = 'stand';
    b.dir = vaga.tx === fila[0]!.tx && vaga.ty === fila[0]!.ty ? 'right' : 'up';
    if (r.fase === 'vai') {
      indo.splice(indo.indexOf(b.id), 1);
      r.fase = 'fila';
      this.elevador.chamar(b.id, de, this.indice(p.para));
    }
  }

  /** Chegou ao destino do passo: senta/para no lugar, com a pose do lugar (passeio). */
  private chegou(b: Boneco, agora: number, alvo?: SpotDef): void {
    if (!alvo) {
      b.pose = 'stand';
      return;
    }
    b.x = alvo.x;
    b.y = alvo.y;
    b.dir = alvo.dir;
    b.seated = !!alvo.seated;
    b.pose = this.pouso(b);
    b.esperaAte = agora + 3500;
  }

  /** Lugar de casa: a mesa; a persona, um lugar livre da Recepção. */
  private lugarDeCasa(b: Boneco): Tile {
    if (b.mesa) return { tx: b.mesa.tx, ty: b.mesa.ty };
    const area = this.cena.salaDe.get(b.sala);
    const sp = area?.spots.find((x) => RECEPCAO.has(x.kind) && !this.ocupados.has(x.id)) ?? area?.spots[0];
    if (sp) return { tx: sp.tx, ty: sp.ty };
    const t = this.tileDe(b, this.cena.grid);
    return t ?? { tx: 0, ty: 0 };
  }

  /** Na frente da mesa: o tile caminhável mais perto, 1 tile para o lado do corredor (D7). */
  private pontoEntrega(mesa: SpotDef, andar: AndarCena): Tile {
    const corr = andar.areas
      .filter((a) => a.kind === 'corridor' && !a.id.startsWith('hall:'))
      .sort((a, b) => Math.abs(a.rect.y + a.rect.h / 2 - mesa.ty) - Math.abs(b.rect.y + b.rect.h / 2 - mesa.ty))[0];
    const lado = corr && corr.rect.y + corr.rect.h / 2 < mesa.ty ? -1 : 1;
    const n = this.cena.grid.nearestWalkable(mesa.tx, mesa.ty + lado, 3);
    return n ? { tx: n.x, ty: n.y } : { tx: mesa.tx, ty: mesa.ty };
  }

  private salaDoPerfil(perfil: string): string | undefined {
    return this.lista.find((b) => b.o.perfil === perfil)?.sala;
  }

  private areaDoPerfil(perfil: string): AreaLayout | undefined {
    const s = this.salaDoPerfil(perfil);
    return s ? this.cena.salaDe.get(s) : undefined;
  }

  /** Boneco pelo id da viagem; `persona:<perfil>` é a persona na Recepção. */
  private achar(id: string): Boneco | undefined {
    const b = this.porId.get(id);
    if (b) return b;
    if (id.startsWith('persona:')) {
      const perfil = id.slice('persona:'.length);
      return this.lista.find((x) => x.sala === 'recepcao' && x.o.perfil === perfil);
    }
    return undefined;
  }

  private remover(b: Boneco): void {
    if (b.rot?.viagem) this.aoTerminar?.(b.rot.viagem, false);
    b.rot = undefined;
    for (const ids of this.indo.values()) {
      const i = ids.indexOf(b.id);
      if (i >= 0) ids.splice(i, 1);
    }
    this.soltarMesa(b);
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    this.porId.delete(b.id);
    const i = this.lista.indexOf(b);
    if (i >= 0) this.lista.splice(i, 1);
  }

  private soltarMesa(b: Boneco): void {
    if (!b.mesa) return;
    this.ocupados.delete(b.mesa.id);
    if (this.porMesa.get(b.mesa.id) === b) this.porMesa.delete(b.mesa.id);
    b.mesa = undefined;
  }

  private escolherMesa(area: AreaLayout | undefined, k: number): SpotDef | undefined {
    if (!area) return undefined;
    const mesas = area.spots.filter((s) => s.kind === 'desk');
    for (let i = k; i < k + ORDEM_MESA.length; i++) {
      const want = ORDEM_MESA[i % ORDEM_MESA.length]!;
      const s = mesas.find((m) => area.furniture.find((f) => f.id === m.deskId)?.seat === want && !this.ocupados.has(m.id));
      if (s) return s;
    }
    return mesas.find((m) => !this.ocupados.has(m.id));
  }

  /**
   * Pose, lugar e modo conforme o estado do ocupante. `novo`: põe o boneco direto no lugar (sem andar até lá).
   * Fora de casa (outro andar, ou longe da mesa quando tem de sentar), primeiro volta andando (pelo elevador se
   * preciso) e só então assume o estado.
   */
  private configurar(b: Boneco, area: AreaLayout | undefined, k: number, novo: boolean): void {
    const o = b.o;
    const estavaSentado = b.seated;
    if (novo) b.onde = b.andar.id;
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    b.alvo = undefined;
    b.path = [];
    b.pi = 0;
    b.esperaAte = 0;
    b.icone = undefined;
    b.held = 'none';
    b.caixaAte = undefined;
    if (b.sala === 'recepcao' || b.andar.id === 'terreo') {
      // personas: conversando (celular) ou passeando pela recepção
      this.soltarMesa(b);
      if (!novo && b.onde !== b.andar.id && this.voltarParaCasa(b, area, k)) return;
      const sp = area?.spots.filter((x) => RECEPCAO.has(x.kind)).find((x) => !this.ocupados.has(x.id));
      if (sp) this.ocupados.add(sp.id);
      b.alvo = sp;
      b.modo = o.estado === 'conversando' ? 'fixo' : 'passeia';
      if (sp) Object.assign(b, { x: sp.x, y: sp.y, dir: sp.dir, seated: !!sp.seated });
      b.pose = o.estado === 'conversando' ? 'talk' : sp?.seated ? 'sit' : 'stand';
      b.held = o.estado === 'conversando' ? 'phone' : 'none';
      b.icone = o.estado === 'conversando' ? 'chat' : undefined;
      return;
    }
    if (!b.mesa) {
      b.mesa = this.escolherMesa(area, k);
      if (b.mesa) {
        this.ocupados.add(b.mesa.id);
        this.porMesa.set(b.mesa.id, b);
      }
      if (b.onde === b.andar.id) novo = true;
    }
    const sentado = o.perfil === 'victor' || o.estado === 'running' || o.estado === 'blocked' || o.estado === 'guarded';
    const longe = b.mesa && (Math.abs(b.x - b.mesa.x) > TILE || Math.abs(b.y - b.mesa.y) > TILE * 1.5);
    if (!novo && (b.onde !== b.andar.id || (sentado && longe)) && this.voltarParaCasa(b, area, k)) return;
    if (sentado) {
      if (b.mesa) Object.assign(b, { x: b.mesa.x, y: b.mesa.y, dir: b.mesa.dir });
      b.modo = 'mesa';
      b.seated = true;
      if (o.perfil === 'victor') {
        b.pose = o.estado === 'blocked' ? 'raise_hand' : 'read';
        b.held = o.estado === 'blocked' ? 'none' : 'papers';
        b.icone = o.estado === 'blocked' ? 'alert' : undefined;
      } else if (o.estado === 'running') b.pose = 'type';
      else if (o.estado === 'blocked') {
        b.pose = 'raise_hand';
        b.icone = 'alert';
      } else {
        b.pose = 'sulk';
        b.icone = 'storm';
      }
      return;
    }
    if (novo && b.mesa) Object.assign(b, { x: b.mesa.x, y: b.mesa.y, dir: b.mesa.dir });
    // levanta: fica em pé ao lado da mesa
    if ((novo || estavaSentado) && b.mesa) b.y = b.mesa.y + (b.mesa.dir === 'down' ? -2 : 2);
    b.seated = false;
    b.pose = 'stand';
    if (o.estado === 'delivering') {
      b.modo = 'entrega';
      b.held = 'box';
      b.icone = 'box';
    } else b.modo = 'passeia';
  }

  /** Volta andando até a mesa (ou à Recepção) e só então assume o estado. false = sem caminho (fica onde está). */
  private voltarParaCasa(b: Boneco, area: AreaLayout | undefined, k: number): boolean {
    const casa = this.lugarDeCasa(b);
    const passos = this.rota(b, b.andar.id, casa);
    if (!passos) {
      if (b.onde === b.andar.id) return false;
      // sem caminho noutro andar: põe em casa (melhor que atravessar a laje andando)
      b.onde = b.andar.id;
      this.configurar(b, area, k, true);
      return true;
    }
    this.comecar(b, { passos, i: 0, fim: () => this.configurar(b, this.cena.salaDe.get(b.sala), k, false) });
    return true;
  }

  private irPara(b: Boneco, pf: PathFinder, grid: WalkGrid, tx: number, ty: number): boolean {
    const t = this.tileDe(b, grid);
    if (!t) return false;
    const out: number[] = [];
    if (!pf.find(t.tx, t.ty, tx, ty, out) || !out.length) return false;
    b.path = out;
    b.pi = 0;
    b.seated = false;
    b.pose = 'walk';
    return true;
  }

  /** Um passo no caminho atual; true = chegou ao fim. */
  private andar(b: Boneco, dt: number): boolean {
    if (b.pi >= b.path.length) return true;
    const gx = b.path[b.pi]! * TILE + TILE / 2;
    const gy = b.path[b.pi + 1]! * TILE + 11;
    const dx = gx - b.x;
    const dy = gy - b.y;
    const d = Math.hypot(dx, dy);
    const step = SPEED * dt;
    b.pose = 'walk';
    if (Math.abs(dx) > Math.abs(dy)) b.dir = dx > 0 ? 'right' : 'left';
    else if (d > 0.5) b.dir = dy > 0 ? 'down' : 'up';
    if (d <= step) {
      b.x = gx;
      b.y = gy;
      b.pi += 2;
      return b.pi >= b.path.length;
    }
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;
    return false;
  }

  private passoBoneco(b: Boneco, dt: number, agora: number, pf: PathFinder, rnd: () => number): void {
    if (b.caixaAte !== undefined && agora >= b.caixaAte && !b.rot) {
      // segurou o 📦 2 s: volta ao estado dele
      b.caixaAte = undefined;
      this.configurar(b, this.cena.salaDe.get(b.sala), 0, false);
    }
    if (b.rot) return this.passoRoteiro(b, dt, agora, pf);
    if (b.modo === 'mesa' || b.modo === 'fixo' || b.caixaAte !== undefined) return;
    const cena = this.cena;
    if (b.pi < b.path.length) {
      if (this.andar(b, dt)) {
        const a = b.alvo;
        if (a) {
          b.x = a.x;
          b.y = a.y;
          b.dir = a.dir;
          b.seated = !!a.seated;
        }
        b.pose = this.pouso(b);
        b.esperaAte = agora + 3500 + rnd() * 5000;
      }
      return;
    }
    if (agora < b.esperaAte) return;
    // escolhe o próximo destino
    if (b.alvo && b.alvo !== b.mesa) this.ocupados.delete(b.alvo.id);
    b.alvo = undefined;
    // passeou noutro andar: volta para casa pelo elevador
    if (b.onde !== b.andar.id) {
      if (!this.voltarParaCasa(b, cena.salaDe.get(b.sala), 0)) b.esperaAte = agora + 2000;
      return;
    }
    let alvo: SpotDef | undefined;
    if (b.modo === 'entrega') {
      // vai e volta entre a mesa e o corredor do andar, com a caixa
      const corr = b.andar.areas.find((a) => a.kind === 'corridor' && !a.id.startsWith('hall:'));
      const naMesa = b.mesa && Math.abs(b.x - b.mesa.x) < 20 && Math.abs(b.y - b.mesa.y) < 20;
      if (naMesa && corr) {
        const tx = corr.rect.x + 2 + Math.floor(rnd() * (corr.rect.w - 4));
        if (this.irPara(b, pf, cena.grid, tx, corr.rect.y + 2)) b.held = 'box';
        b.esperaAte = 0;
        return;
      }
      alvo = b.mesa;
    } else {
      // à toa: às vezes vai à copa de outro andar (pelo elevador, nunca atravessando a laje)
      const fora = b.andar.id !== 'terreo' ? this.copasDeFora(b.andar) : [];
      if (fora.length && rnd() < PASSEIO_FORA) {
        const sp = fora[Math.floor(rnd() * fora.length)]!;
        const passos = this.rota(b, sp.andar, { tx: sp.s.tx, ty: sp.s.ty }, sp.s);
        if (passos) {
          this.ocupados.add(sp.s.id);
          this.comecar(b, { passos, i: 0, fim: (x, t) => ((x.alvo = sp.s), (x.esperaAte = t + 3500 + rnd() * 5000)) });
          return;
        }
      }
      const opcoes = b.andar.passeio.flatMap((a) => a.spots).filter((s) => PASSEIO.has(s.kind) && !this.ocupados.has(s.id) && cena.grid.walkable(s.tx, s.ty));
      const sala = b.mesa ? cena.andar(b.andar, b.mesa.areaId) : undefined;
      const proprias = sala?.spots.filter((s) => (s.kind === 'whiteboard' || s.kind === 'stand') && !this.ocupados.has(s.id)) ?? [];
      const todas = [...opcoes, ...proprias];
      alvo = todas[Math.floor(rnd() * todas.length)];
    }
    if (!alvo) {
      b.esperaAte = agora + 2000;
      return;
    }
    // a própria mesa já está reservada para ele; os outros lugares, só enquanto ele está lá
    if (alvo !== b.mesa) this.ocupados.add(alvo.id);
    b.alvo = alvo;
    if (!this.irPara(b, pf, cena.grid, alvo.tx, alvo.ty)) {
      if (alvo !== b.mesa) this.ocupados.delete(alvo.id);
      b.alvo = undefined;
      b.esperaAte = agora + 1500;
    }
  }

  /** Lugares livres da copa nos outros andares (fora o Térreo, que é das personas). */
  private copasDeFora(casa: AndarCena): { andar: AndarId; s: SpotDef }[] {
    if (casa.passeio.some((a) => a.id.endsWith(':copa'))) return [];
    return this.cena.andares
      .filter((a) => a.id !== casa.id && a.id !== 'terreo')
      .flatMap((a) => a.passeio.filter((ar) => ar.id.endsWith(':copa')).flatMap((ar) => ar.spots.map((s) => ({ andar: a.id, s }))))
      .filter(({ s }) => PASSEIO.has(s.kind) && !this.ocupados.has(s.id) && this.cena.grid.walkable(s.tx, s.ty));
  }

  private pouso(b: Boneco): Pose {
    if (b.modo === 'entrega') {
      b.held = 'box';
      return 'stand';
    }
    const k = b.alvo?.kind;
    b.held = 'none';
    b.icone = undefined;
    if (k === 'coffee' || k === 'snack' || k === 'fridge' || (k === 'window' && b.seed % 2 === 0)) {
      b.held = 'coffee';
      b.icone = 'coffee';
      return 'drink';
    }
    if (k === 'water') {
      b.held = 'water';
      return 'drink';
    }
    if (k === 'talk') return 'talk';
    if (k === 'whiteboard') {
      b.held = 'papers';
      return 'read';
    }
    if (k === 'cafe_seat' || k === 'bench' || k === 'armchair') {
      b.held = 'coffee';
      b.icone = 'coffee';
      return 'sit';
    }
    return 'stand';
  }
}
