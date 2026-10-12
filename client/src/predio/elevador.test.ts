import { describe, expect, it } from "vitest";
import { CAPACIDADE, ElevadorPredio, type Evento } from "./elevador";

const COB = 0;
const TERREO = 3;

/** Roda `ms` em ticks de `dt`, conferindo que a cabine nunca está entre andares com a porta aberta. */
function rodar(el: ElevadorPredio, ms: number, dt = 50): Evento[] {
  const ev: Evento[] = [];
  for (let t = 0; t < ms; t += dt) {
    ev.push(...el.tick(dt));
    if (!Number.isInteger(el.posicao)) expect(el.porta).toBe(0); // entre andares, porta fechada
  }
  return ev;
}

const ids = (ev: Evento[], tipo: Evento["tipo"]) =>
  ev
    .filter((e) => e.tipo === tipo)
    .map((e) => ("id" in e ? `${e.id}@${e.andar}` : `${e.andar}`));

describe("ElevadorPredio", () => {
  it("começa parado no Térreo, porta fechada", () => {
    const el = new ElevadorPredio(4);
    expect(el.posicao).toBe(TERREO);
    expect(el.porta).toBe(0);
    expect(rodar(el, 2000)).toEqual([]);
  });

  it("1 passageiro Térreo → Cobertura: embarca, sobe e desembarca", () => {
    const el = new ElevadorPredio(4);
    el.chamar("dev", TERREO, COB);
    expect(el.fila(TERREO)).toEqual(["dev"]);
    const ev = rodar(el, 8000);
    expect(ids(ev, "embarcou")).toEqual(["dev@3"]);
    expect(ids(ev, "desembarcou")).toEqual(["dev@0"]);
    expect(ev.filter((e) => e.tipo === "porta")).toEqual([
      { tipo: "porta", andar: 3, aberta: true },
      { tipo: "porta", andar: 3, aberta: false },
      { tipo: "porta", andar: 0, aberta: true },
      { tipo: "porta", andar: 0, aberta: false },
    ]);
    expect(el.posicao).toBe(COB);
    expect(el.carga).toEqual([]);
    expect(el.fila(TERREO)).toEqual([]);
  });

  it("a cabine passa por posições fracionárias entre paradas", () => {
    const el = new ElevadorPredio(4);
    el.chamar("a", TERREO, COB);
    const vistas = new Set<number>();
    for (let t = 0; t < 8000; t += 50) {
      el.tick(50);
      vistas.add(el.posicao);
    }
    expect(
      [...vistas].some((p) => p > 0 && p < 3 && !Number.isInteger(p)),
    ).toBe(true);
  });

  it("5 na fila do mesmo andar: embarcam 3 em ordem de chegada, os 2 restantes na próxima parada", () => {
    const el = new ElevadorPredio(4);
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) el.chamar(id, TERREO, COB);
    let ev = rodar(el, 2000);
    expect(ids(ev, "embarcou")).toEqual(["p1@3", "p2@3", "p3@3"]);
    expect(el.carga).toEqual(["p1", "p2", "p3"]);
    expect(el.carga.length).toBe(CAPACIDADE);
    expect(el.fila(TERREO)).toEqual(["p4", "p5"]);
    ev = rodar(el, 20000);
    expect(ids(ev, "desembarcou").slice(0, 3)).toEqual([
      "p1@0",
      "p2@0",
      "p3@0",
    ]);
    const paradas = ev
      .filter((e) => e.tipo === "porta" && e.aberta)
      .map((e) => e.andar);
    expect(paradas).toEqual([0, 3, 0]); // próxima parada depois da Cobertura volta ao Térreo
    expect(ids(ev, "embarcou")).toEqual(["p4@3", "p5@3"]);
    expect(ids(ev, "desembarcou").slice(3)).toEqual(["p4@0", "p5@0"]);
  });

  it("desembarque antes do embarque na mesma parada", () => {
    const el = new ElevadorPredio(4);
    el.chamar("sobe", TERREO, 1);
    rodar(el, 1500); // embarcou no Térreo
    el.chamar("espera", 1, TERREO);
    const ev = rodar(el, 8000).filter((e) => e.tipo !== "porta");
    expect(ev.slice(0, 2)).toEqual([
      { tipo: "desembarcou", id: "sobe", andar: 1 },
      { tipo: "embarcou", id: "espera", andar: 1 },
    ]);
  });

  it("cabine nunca anda com a porta aberta (tráfego misto, ticks irregulares)", () => {
    const el = new ElevadorPredio(4, 1);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      if (i % 7 === 0) el.chamar(`x${n++}`, i % 4, (i + 1 + (i % 3)) % 4);
      const dt = [16, 33, 120, 7][i % 4];
      el.tick(dt);
      if (!Number.isInteger(el.posicao)) expect(el.porta).toBe(0);
      expect(el.porta).toBeGreaterThanOrEqual(0);
      expect(el.porta).toBeLessThanOrEqual(4);
      expect(el.carga.length).toBeLessThanOrEqual(CAPACIDADE);
    }
  });

  /** 5 andares (0..4, Térreo = 4): `a` vai do Térreo ao 2 e já está subindo quando chegam as outras chamadas. */
  function subindoPara2(): ElevadorPredio {
    const el = new ElevadorPredio(5);
    el.chamar("a", 4, 2);
    while (el.posicao === 4) rodar(el, 50);
    expect(el.carga).toEqual(["a"]);
    return el;
  }
  const paradas = (ev: Evento[]) =>
    ev.filter((e) => e.tipo === "porta" && e.aberta).map((e) => e.andar);

  it("sentido mantido: subindo, vai ao andar de cima (mais longe) antes do de baixo (mais perto)", () => {
    const el = subindoPara2();
    el.chamar("cima", 0, 4); // 2 andares acima do 2
    el.chamar("baixo", 3, 0); // 1 andar abaixo do 2
    const ev = rodar(el, 30000);
    expect(paradas(ev)).toEqual([2, 0, 3, 4, 0]);
    expect(ids(ev, "desembarcou")).toEqual(["a@2", "cima@4", "baixo@0"]);
  });

  it("sentido invertido: sem pedido no sentido atual, inverte", () => {
    const el = subindoPara2();
    el.chamar("b", 3, 4); // só há pedido abaixo
    const ev = rodar(el, 15000);
    expect(paradas(ev)).toEqual([2, 3, 4]);
    expect(ids(ev, "embarcou")).toEqual(["b@3"]);
    expect(ids(ev, "desembarcou")).toEqual(["a@2", "b@4"]);
    expect(el.posicao).toBe(4);
  });

  it("sem fome: chamadas alternadas em 4 andares por 200 ticks, todas atendidas em ≤ 8 paradas", () => {
    const el = new ElevadorPredio(4);
    const chamadaEm = new Map<string, number>();
    const esperou = new Map<string, number>();
    const entregues = new Set<string>();
    let paradas = 0;
    let n = 0;
    const tratar = (ev: Evento[]) => {
      for (const e of ev) {
        if (e.tipo === "porta" && e.aberta) paradas++;
        if (e.tipo === "embarcou")
          esperou.set(e.id, paradas - chamadaEm.get(e.id)!);
        if (e.tipo === "desembarcou") entregues.add(e.id);
      }
    };
    for (let i = 0; i < 200; i++) {
      // 1 chamada a cada 1,5 s: abaixo da vazão da cabine (acima disso a fila só cresce e nenhuma ordem limita a espera)
      if (i % 15 === 0) {
        // alterna origem entre os extremos e o meio: 0, 3, 1, 2, 0, 3…
        const de = [0, 3, 1, 2][n % 4];
        const para = (de + 1 + (n % 3)) % 4; // nunca igual a `de`
        const id = `c${n++}`;
        chamadaEm.set(id, paradas);
        el.chamar(id, de, para);
      }
      tratar(el.tick(100));
    }
    for (let i = 0; i < 1000 && entregues.size < n; i++) tratar(el.tick(100));
    expect(n).toBe(14);
    expect(entregues.size).toBe(n);
    expect(esperou.size).toBe(n);
    expect(Math.max(...esperou.values())).toBeLessThanOrEqual(8);
  });

  it("resolverTudo esvazia fila e cabine na hora", () => {
    const el = new ElevadorPredio(4);
    el.chamar("a", TERREO, COB);
    el.chamar("b", TERREO, 1);
    rodar(el, 1700); // a e b na cabine
    el.chamar("c", 2, TERREO);
    el.chamar("d", COB, 2);
    expect(el.carga).toEqual(["a", "b"]);
    const ev = el.resolverTudo();
    expect(ids(ev, "desembarcou").sort()).toEqual(["a@0", "b@1", "c@3", "d@2"]);
    expect(ids(ev, "embarcou").sort()).toEqual(["c@2", "d@0"]);
    expect(el.carga).toEqual([]);
    for (let a = 0; a < 4; a++) expect(el.fila(a)).toEqual([]);
    expect(el.porta).toBe(0);
    expect(rodar(el, 5000)).toEqual([]);
  });

  it("chamar com de === para é ignorado", () => {
    const el = new ElevadorPredio(4);
    el.chamar("a", 2, 2);
    expect(el.fila(2)).toEqual([]);
    expect(rodar(el, 5000)).toEqual([]);
    expect(el.posicao).toBe(TERREO);
  });
});
