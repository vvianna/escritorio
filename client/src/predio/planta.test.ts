import { describe, expect, it } from "vitest";
import { roomTheme } from "../art/theme";
import { PathFinder } from "../world/path/astar";
import {
  exemploPredio,
  montarPredio,
  type AgentePredio,
} from "../ui/predio-model";
import {
  BW,
  BX,
  ESCADA_W,
  HALL_W,
  LAJE,
  MARGEM_D,
  montarCena,
  POCO_W,
  TOPO,
  WT,
  type Cena,
} from "./planta";

const art = { roomTheme };

function cena(extra: boolean): Cena {
  const { agentes, uso } = exemploPredio(0);
  const lista: AgentePredio[] = extra
    ? [...agentes, { id: "h:pl-xyz", provider: "hermes", name: "pl-xyz" }]
    : agentes;
  const v = montarPredio(lista, uso);
  expect(
    v.andares.find((a) => a.id === "ti")!.salas.some((s) => s.id === "extra"),
  ).toBe(extra);
  return montarCena(v, art);
}

describe("planta vertical", () => {
  it("tem as medidas de D2 (WT = 41)", () => {
    expect([BX, BW, HALL_W, POCO_W, ESCADA_W, MARGEM_D, TOPO, LAJE]).toEqual([
      1, 32, 2, 3, 2, 1, 6, 4,
    ]);
    expect(WT).toBe(41);
  });

  for (const extra of [false, true]) {
    describe(extra ? "com a Bancada extra" : "sem a Bancada extra", () => {
      const c = cena(extra);

      it("tem 4 paradas, da Cobertura ao Térreo, de cima para baixo", () => {
        expect(c.andares.map((a) => a.id)).toEqual([
          "cobertura",
          "produto",
          "ti",
          "terreo",
        ]);
        expect(Object.keys(c.paradas)).toEqual([
          "cobertura",
          "produto",
          "ti",
          "terreo",
        ]);
        const cys = c.andares.map((a) => c.paradas[a.id].cy);
        expect([...cys].sort((a, b) => a - b)).toEqual(cys);
        // exemplo da planta.md: Cobertura com cy = 22, Produto 43, TI 64
        expect(cys.slice(0, 3)).toEqual([22, 43, 64]);
        for (const a of c.andares) {
          const p = c.paradas[a.id];
          expect(p.porta).toEqual({ tx: 34, ty: p.cy + 2 });
          expect(p.fila[0]).toEqual(p.porta);
          expect(p.fila.slice(1, 6)).toEqual([
            { tx: 33, ty: p.cy + 2 },
            { tx: 34, ty: p.cy + 3 },
            { tx: 33, ty: p.cy + 3 },
            { tx: 34, ty: p.cy + 4 },
            { tx: 33, ty: p.cy + 4 },
          ]);
          expect(p.fila.every((t) => t.ty >= a.y0 + LAJE && t.ty < a.y1)).toBe(
            true,
          );
        }
      });

      it("porta e fila caminháveis; poço e escada não", () => {
        for (const a of c.andares)
          for (const t of c.paradas[a.id].fila)
            expect(c.grid.walkable(t.tx, t.ty), `${a.id} ${t.tx},${t.ty}`).toBe(
              true,
            );
        for (let ty = 0; ty < c.alturaT; ty++)
          for (let tx = 35; tx <= 39; tx++)
            expect(c.grid.walkable(tx, ty), `${tx},${ty}`).toBe(false);
      });

      it("os andares só se ligam pelo elevador (a laje não é caminhável no hall)", () => {
        for (const a of c.andares)
          for (let ty = a.y0; ty < a.y0 + LAJE; ty++)
            for (let tx = 0; tx < WT; tx++)
              expect(c.grid.walkable(tx, ty)).toBe(false);
      });

      it("toda mesa e todo spot da Recepção alcançam a porta do elevador do seu andar", () => {
        const pf = new PathFinder(c.grid);
        const out: number[] = [];
        let mesas = 0;
        for (const a of c.andares) {
          const { porta } = c.paradas[a.id];
          const spots = a.areas
            .flatMap((ar) => ar.spots)
            .filter(
              (s) =>
                s.kind === "desk" || s.areaId === c.salaDe.get("recepcao")?.id,
            );
          for (const s of spots) {
            if (s.kind === "desk") mesas++;
            expect(
              pf.find(s.tx, s.ty, porta.tx, porta.ty, out),
              `${s.id} -> ${a.id}`,
            ).toBe(true);
          }
        }
        expect(mesas).toBeGreaterThan(20);
        expect(c.salaDe.get("recepcao")!.spots.length).toBeGreaterThan(0);
        if (extra) expect(c.salaDe.has("extra")).toBe(true);
      });

      it("nenhuma área passa de x = 41", () => {
        for (const ar of c.areas) {
          expect(ar.rect.x).toBeGreaterThanOrEqual(0);
          expect(ar.rect.x + ar.rect.w, ar.id).toBeLessThanOrEqual(WT);
          for (const r of ar.walkable)
            expect(r.x + r.w, ar.id).toBeLessThanOrEqual(WT);
          for (const f of ar.furniture) expect(f.tx, f.id).toBeLessThan(WT);
        }
        expect(c.grid.w).toBe(WT);
      });

      it("corredor aberto a leste (sem vidro em ly 1..3) e fechado a oeste", () => {
        const cors = c.areas.filter((ar) => ar.id.endsWith(":corredor"));
        expect(cors.length).toBe(6);
        for (const cor of cors) {
          const vidro = cor.furniture.filter(
            (f) => f.kind === "glass_partition",
          );
          const leste = vidro
            .filter((f) => f.tx === BX + BW - 1)
            .map((f) => f.ty - cor.rect.y);
          const oeste = vidro
            .filter((f) => f.tx === BX)
            .map((f) => f.ty - cor.rect.y);
          expect(leste).toEqual([0, 4]);
          expect(oeste).toEqual([0, 1, 2, 3, 4]);
          for (let ly = 1; ly <= 3; ly++)
            expect(c.grid.walkable(BX + BW - 1, cor.rect.y + ly)).toBe(true);
        }
      });
    });
  }
});
