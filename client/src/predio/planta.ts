// Planta do prédio vertical (spec predio-vertical, D2): os andares do time empilhados de cima para baixo,
// montados com as mesmas áreas do mapa das salas (client/src/world/layout), e a coluna do elevador à direita
// (hall de cada andar, poço e escada). Puro: não desenha nada; `render.ts` faz o desenho a partir da `Cena`.
// Copiado e organizado do protótipo (branch prototipo/predio-vertical, client/src/prototipo/predio-vertical.ts).
import { TILE, type ArtModule } from "../art/api";
import { hash32 } from "../../../shared/hash";
import { paintArea } from "../world/layout/building";
import { AreaBuilder } from "../world/layout/builder";
import { layoutCafe, layoutReception } from "../world/layout/core";
import { layoutCorridor } from "../world/layout/corridor";
import { layoutProjectRoom } from "../world/layout/room";
import type { AreaLayout, ExteriorProp } from "../world/layout/types";
import { WalkGrid } from "../world/path/grid";
import type { AndarId, PredioVista } from "../ui/predio-model";

/** Gramado à esquerda do prédio (tiles). */
export const BX = 1;
/** Prédio: 2 salas de 16 tiles. */
export const BW = 32;
/** Hall de cada andar, colado no prédio (caminhável). */
export const HALL_W = 2;
/** Poço do elevador (a cabine tem 3 × 2 tiles). */
export const POCO_W = 3;
/** Escada (cenário, ninguém usa). */
export const ESCADA_W = 2;
/** Gramado à direita. */
export const MARGEM_D = 1;
/** Largura total da cena em tiles (= 41, 656 px). */
export const WT = BX + BW + HALL_W + POCO_W + ESCADA_W + MARGEM_D;
/** Gramado acima do prédio. */
export const TOPO = 6;
/** Faixa de tijolo entre andares (onde fica a placa do andar, alvo de toque). */
export const LAJE = 4;

/** x (tiles) do começo do hall, do poço e da escada. */
export const HALL_X = BX + BW;
export const POCO_X = HALL_X + HALL_W;
export const ESCADA_X = POCO_X + POCO_W;

const ROOM_H = 12;
const COR_H = 5;

type Peca =
  | { tipo: "sala"; id: string; nome: string }
  | { tipo: "copa" }
  | { tipo: "recepcao" }
  | { tipo: "terraco" };
interface Bloco {
  n: [Peca, Peca];
  s?: [Peca, Peca];
}
interface AndarPlanta {
  id: AndarId;
  titulo: string;
  blocos: Bloco[];
}

export interface AndarCena {
  id: AndarId;
  titulo: string;
  y0: number; // tiles (topo da laje)
  y1: number; // tiles (fim do andar)
  areas: AreaLayout[];
  /** Áreas onde quem está à toa passeia (corredor, copa, recepção). */
  passeio: AreaLayout[];
}

export interface Tile {
  tx: number;
  ty: number;
}

/** Parada da cabine num andar: `cy` = y do primeiro corredor; `fila[0]` é o tile da porta. */
export interface Parada {
  cy: number;
  porta: Tile;
  fila: Tile[];
}

export interface Cena {
  /** De cima para baixo: Cobertura, 3º, 2º TI, Térreo. */
  andares: AndarCena[];
  /** Todas as áreas (salas, copa, recepção, terraços, corredores e halls). */
  areas: AreaLayout[];
  props: ExteriorProp[];
  grid: WalkGrid;
  alturaT: number;
  ruaY: number; // px
  /** Topo (y em tiles) do prédio, onde começam o poço e a escada; o fim é o `y1` do Térreo. */
  predioY0: number;
  predioY1: number;
  salaDe: Map<string, AreaLayout>;
  paradas: Record<AndarId, Parada>;
  andar(a: AndarCena, areaId: string): AreaLayout | undefined;
}

/** Copia uma área do mapa original para outro lugar (dx, dy em tiles), com ids novos. */
export function mover(
  a: AreaLayout,
  dx: number,
  dy: number,
  novoId: string,
): AreaLayout {
  const px = dx * TILE;
  const py = dy * TILE;
  const rid = (id: string | undefined) =>
    id === undefined ? undefined : id.split(a.id).join(novoId);
  return {
    ...a,
    id: novoId,
    rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy },
    floors: a.floors.map((f) => ({ ...f, x: f.x + px, y: f.y + py })),
    rugs: a.rugs.map((r) => ({ ...r, x: r.x + px, y: r.y + py })),
    walls: a.walls.map((w) =>
      w.kind === "cap"
        ? { ...w, x: w.x + px, y: w.y + py }
        : {
            ...w,
            x: w.x + px,
            y: w.y + py,
            doorways: w.doorways?.map((d) => ({ ...d, x: d.x + px })),
          },
    ),
    wallItems: a.wallItems.map((w) => ({
      ...w,
      id: rid(w.id)!,
      cx: w.cx + px,
      baseY: w.baseY + py,
    })),
    furniture: a.furniture.map((f) => ({
      ...f,
      id: rid(f.id)!,
      tx: f.tx + dx,
      ty: f.ty + dy,
    })),
    spots: a.spots.map((s) => ({
      ...s,
      id: rid(s.id)!,
      areaId: novoId,
      tx: s.tx + dx,
      ty: s.ty + dy,
      x: s.x + px,
      y: s.y + py,
      sortY: s.sortY === undefined ? undefined : s.sortY + py,
      furnitureId: rid(s.furnitureId),
      deskId: rid(s.deskId),
      group: s.group ? `${novoId}:${s.group}` : undefined,
    })),
    walkable: a.walkable.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    blocked: a.blocked?.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    door: a.door
      ? { ...a.door, x: a.door.x + dx, y: a.door.y + dy }
      : undefined,
    shade: a.shade
      ? { ...a.shade, x: a.shade.x + px, y: a.shade.y + py }
      : undefined,
    signId: rid(a.signId),
  };
}

export function plantaVertical(v: PredioVista): AndarPlanta[] {
  const sala = (andar: AndarId, id: string): Peca => {
    const s = v.andares
      .find((a) => a.id === andar)!
      .salas.find((x) => x.id === id)!;
    return { tipo: "sala", id: s.id, nome: s.nome };
  };
  const ti = v.andares
    .find((a) => a.id === "ti")!
    .salas.map((s) => ({ tipo: "sala", id: s.id, nome: s.nome }) as Peca);
  const blocosTi: Bloco[] = [];
  for (let i = 0; i < ti.length; i += 4) {
    const g = ti.slice(i, i + 4);
    const par = (a?: Peca, b?: Peca): [Peca, Peca] => [
      a ?? { tipo: "terraco" },
      b ?? { tipo: "terraco" },
    ];
    blocosTi.push(
      g.length > 2
        ? { n: par(g[0], g[1]), s: par(g[2], g[3]) }
        : { n: par(g[0], g[1]) },
    );
  }
  return [
    {
      id: "cobertura",
      titulo: "Cobertura · Negócio",
      blocos: [{ n: [sala("cobertura", "victor"), { tipo: "terraco" }] }],
    },
    {
      id: "produto",
      titulo: "3º · Produto",
      blocos: [{ n: [sala("produto", "produto"), { tipo: "copa" }] }],
    },
    { id: "ti", titulo: "2º · TI", blocos: blocosTi },
    {
      id: "terreo",
      titulo: "Térreo · Personas",
      blocos: [{ n: [{ tipo: "recepcao" }, { tipo: "terraco" }] }],
    },
  ];
}

export function terraco(
  id: string,
  x: number,
  y: number,
  sul: boolean,
  props: ExteriorProp[],
): AreaLayout {
  const b = new AreaBuilder(id, "lounge", { x, y, w: 16, h: ROOM_H });
  b.floor("grass", 0, 0, 16, ROOM_H, hash32(id) % 97);
  b.floor("sidewalk", 5, 3, 6, 6, 7);
  const s = hash32(id);
  const P = (kind: ExteriorProp["kind"], lx: number, ly: number, k = 0) =>
    props.push({ kind, x: (x + lx) * TILE, y: (y + ly) * TILE, seed: s + k });
  P("tree", 2, 4, 1);
  P("pine", 14, 3, 2);
  P("parasol", 8, 6.5, 3);
  P("bench", 6.5, 9, 4);
  P("flowers", 3, 9, 5);
  P("flowers", 13, 9.5, 6);
  P("bush", 12, 6, 7);
  P("lamp", 11, 9, 8);
  // cerca viva na beira do corredor
  const yh = sul ? 1 : ROOM_H;
  for (let lx = 1; lx < 16; lx += 2) P("hedge", lx, yh, 9 + lx);
  b.walk(1, sul ? 2 : 1, 14, 9);
  return b.build();
}

/** Corredor de 2 salas com a ponta leste aberta para o hall (sem vidro nas linhas locais 1..3). */
function corredorAberto(): AreaLayout {
  const cor = layoutCorridor(2);
  const leste = cor.rect.x + cor.rect.w - 1;
  const aberta = (ty: number) =>
    ty - cor.rect.y >= 1 && ty - cor.rect.y <= COR_H - 2;
  return {
    ...cor,
    furniture: cor.furniture.filter(
      (f) => !(f.kind === "glass_partition" && f.tx === leste && aberta(f.ty)),
    ),
    walkable: [
      ...cor.walkable,
      { x: leste, y: cor.rect.y + 1, w: 1, h: COR_H - 2 },
    ],
  };
}

/** Hall do andar (x 33..34), do fim da laje até o fim do andar; todo caminhável. */
function hall(andar: AndarId, y: number, h: number): AreaLayout {
  const b = new AreaBuilder(`hall:${andar}`, "corridor", {
    x: HALL_X,
    y,
    w: HALL_W,
    h,
  });
  b.floor("concrete", 0, 0, HALL_W, h, hash32(`hall:${andar}`) % 97);
  b.walk(0, 0, HALL_W, h);
  return b.build();
}

/** Porta (34, cy + 2) e a fila: (33, cy+2), (34, cy+3), (33, cy+3)… descendo pelo hall até o fim do andar. */
function parada(cy: number, y1: number): Parada {
  const porta = { tx: HALL_X + 1, ty: cy + 2 };
  const fila: Tile[] = [porta, { tx: HALL_X, ty: cy + 2 }];
  for (let ty = cy + 3; ty < y1; ty++)
    fila.push({ tx: HALL_X + 1, ty }, { tx: HALL_X, ty });
  return { cy, porta, fila };
}

export function montarCena(
  v: PredioVista,
  art: Pick<ArtModule, "roomTheme">,
): Cena {
  const andares: AndarCena[] = [];
  const props: ExteriorProp[] = [];
  const salaDe = new Map<string, AreaLayout>();
  const paradas = {} as Record<AndarId, Parada>;
  let y = TOPO;
  for (const ap of plantaVertical(v)) {
    const a: AndarCena = {
      id: ap.id,
      titulo: ap.titulo,
      y0: y,
      y1: 0,
      areas: [],
      passeio: [],
    };
    y += LAJE;
    let cy: number | undefined;
    ap.blocos.forEach((bl, bi) => {
      const linha = (pecas: [Peca, Peca], yy: number, sul: boolean) => {
        pecas.forEach((p, i) => {
          const x = BX + i * 16;
          const id = `${ap.id}:${bi}:${sul ? "s" : "n"}${i}`;
          let area: AreaLayout;
          if (p.tipo === "sala") {
            const seed = hash32(`sala:${p.id}`);
            const theme = art.roomTheme(seed);
            const orig = layoutProjectRoom(
              { id: `sala:${p.id}`, slot: sul ? 1 : 0, seed },
              theme,
            );
            area = mover(
              orig,
              x - orig.rect.x,
              yy - orig.rect.y,
              `sala:${p.id}`,
            );
            salaDe.set(p.id, area);
          } else if (p.tipo === "copa") {
            const orig = layoutCafe();
            area = mover(orig, x - orig.rect.x, yy - orig.rect.y, `${id}:copa`);
            a.passeio.push(area);
          } else if (p.tipo === "recepcao") {
            const orig = layoutReception();
            area = mover(
              orig,
              x - orig.rect.x,
              yy - orig.rect.y,
              `${id}:recepcao`,
            );
            salaDe.set("recepcao", area);
            a.passeio.push(area);
          } else area = terraco(`${id}:terraco`, x, yy, sul, props);
          a.areas.push(area);
        });
      };
      linha(bl.n, y, false);
      const cor = corredorAberto();
      const corr = mover(
        cor,
        BX - cor.rect.x,
        y + ROOM_H - cor.rect.y,
        `${ap.id}:${bi}:corredor`,
      );
      cy ??= corr.rect.y;
      a.areas.push(corr);
      a.passeio.push(corr);
      if (bl.s) {
        linha(bl.s, y + ROOM_H + COR_H, true);
        y += ROOM_H + COR_H + ROOM_H;
      } else y += ROOM_H + COR_H;
    });
    a.y1 = y;
    a.areas.push(hall(ap.id, a.y0 + LAJE, a.y1 - (a.y0 + LAJE)));
    paradas[ap.id] = parada(cy!, a.y1);
    andares.push(a);
  }
  const ruaY = (y + 1) * TILE;
  const alturaT = y + 1 + 2 + 4 + 5;
  // árvores nas laterais (o gramado do mapa)
  for (let ty = 2; ty < alturaT; ty += 3) {
    props.push({
      kind: ty % 2 ? "pine" : "tree",
      x: (BX / 2) * TILE,
      y: ty * TILE + 8,
      seed: ty,
    });
    props.push({
      kind: ty % 2 ? "tree" : "pine",
      x: (WT - MARGEM_D / 2) * TILE,
      y: ty * TILE + 20,
      seed: ty + 3,
    });
  }
  for (let tx = 3; tx < WT - 2; tx += 4)
    props.push({
      kind: tx % 8 === 3 ? "tree" : "bush",
      x: tx * TILE + 6,
      y: 3 * TILE + (tx % 3) * 6,
      seed: tx,
    });
  for (let tx = 2; tx < WT; tx += 6)
    props.push({
      kind: "lamp",
      x: tx * TILE,
      y: ruaY + 2 * TILE - 2,
      seed: tx,
    });
  const areas = andares.flatMap((a) => a.areas);
  // poço e escada não são áreas: a grade começa toda bloqueada e só as áreas pintam tiles livres
  const grid = new WalkGrid(WT, alturaT);
  for (const ar of areas) paintArea(grid, ar);
  return {
    andares,
    areas,
    props,
    grid,
    alturaT,
    ruaY,
    predioY0: TOPO,
    predioY1: andares[andares.length - 1]!.y1,
    salaDe,
    paradas,
    andar: (a, id) => a.areas.find((x) => x.id === id),
  };
}
