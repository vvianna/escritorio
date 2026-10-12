import { describe, expect, it } from 'vitest';
import { roomTheme } from '../art/theme';
import { exemploPredio, montarPredio } from '../ui/predio-model';
import type { AreaLayout } from '../world/layout/types';
import { PathFinder } from '../world/path/astar';
import { LAJE, montarCena, type AndarCena, type Cena, type Tile } from './planta';
import { rotaPredio, type EtapaRota } from './rotas';

const cena = (): Cena => {
  const { agentes, uso } = exemploPredio(0);
  return montarCena(montarPredio(agentes, uso), { roomTheme });
};

const primeiroTile = (area: AreaLayout, c: Cena, porta: Tile): Tile => {
  const pf = new PathFinder(c.grid);
  const out: number[] = [];
  for (const r of area.walkable) {
    for (let ty = r.y; ty < r.y + r.h; ty++) {
      for (let tx = r.x; tx < r.x + r.w; tx++) {
        if (c.grid.walkable(tx, ty) && pf.find(tx, ty, porta.tx, porta.ty, out)) return { tx, ty };
      }
    }
  }
  throw new Error(`área sem tile ligado à porta: ${area.id}`);
};

const tileDoAndar = (andar: AndarCena, c: Cena): Tile =>
  primeiroTile(andar.passeio[0] ?? andar.areas[0]!, c, c.paradas[andar.id].porta);

function tilesDaEtapa(e: Extract<EtapaRota, { tipo: 'andar' }>): Tile[] {
  return [e.de, ...e.caminho];
}

describe('rotaPredio', () => {
  it('mesmo andar devolve só caminho direto, sem fila nem elevador', () => {
    const c = cena();
    const ti = c.andares.find((a) => a.id === 'ti')!;
    const origem = tileDoAndar(ti, c);
    const destino = c.paradas.ti.porta;

    const rota = rotaPredio(c, { andar: 'ti', tile: origem }, { andar: 'ti', tile: destino });

    expect(rota.etapas).toHaveLength(1);
    expect(rota.etapas[0]).toMatchObject({ tipo: 'andar', andar: 'ti', de: origem, para: destino });
    expect((rota.etapas[0] as Extract<EtapaRota, { tipo: 'andar' }>).caminho.at(-1)).toEqual(destino);
  });

  it('troca de andar: hall → fila → embarque → desembarque → destino', () => {
    const c = cena();
    const origem = tileDoAndar(c.andares.find((a) => a.id === 'ti')!, c);
    const destino = tileDoAndar(c.andares.find((a) => a.id === 'produto')!, c);

    const rota = rotaPredio(c, { andar: 'ti', tile: origem }, { andar: 'produto', tile: destino });

    expect(rota.etapas.map((e) => e.tipo)).toEqual(['andar', 'fila', 'embarque', 'desembarque', 'andar']);
    expect(rota.etapas[0]).toMatchObject({ tipo: 'andar', andar: 'ti', de: origem, para: c.paradas.ti.porta });
    expect(rota.etapas[1]).toEqual({ tipo: 'fila', andar: 'ti', porta: c.paradas.ti.porta, fila: c.paradas.ti.fila });
    expect(rota.etapas[2]).toEqual({ tipo: 'embarque', andar: 'ti', indiceAndar: 2, porta: c.paradas.ti.porta });
    expect(rota.etapas[3]).toEqual({ tipo: 'desembarque', andar: 'produto', indiceAndar: 1, porta: c.paradas.produto.porta });
    expect(rota.etapas[4]).toMatchObject({ tipo: 'andar', andar: 'produto', de: c.paradas.produto.porta, para: destino });
  });

  it('passeio à toa entre andares também usa elevador', () => {
    const c = cena();
    const copa = c.andares.find((a) => a.id === 'produto')!.passeio.find((a) => a.id.includes(':copa'))!;
    const recepcao = c.salaDe.get('recepcao')!;

    const rota = rotaPredio(
      c,
      { andar: 'produto', tile: primeiroTile(copa, c, c.paradas.produto.porta) },
      { andar: 'terreo', tile: primeiroTile(recepcao, c, c.paradas.terreo.porta) },
    );

    expect(rota.etapas.map((e) => e.tipo)).toEqual(['andar', 'fila', 'embarque', 'desembarque', 'andar']);
    expect(rota.etapas[2]).toMatchObject({ tipo: 'embarque', andar: 'produto' });
    expect(rota.etapas[3]).toMatchObject({ tipo: 'desembarque', andar: 'terreo' });
  });

  it('nenhum trecho a pé cruza a fronteira entre andares fora do elevador', () => {
    const c = cena();
    const porId = new Map(c.andares.map((a) => [a.id, a]));

    for (const origemAndar of c.andares) {
      for (const destinoAndar of c.andares) {
        const rota = rotaPredio(
          c,
          { andar: origemAndar.id, tile: tileDoAndar(origemAndar, c) },
          { andar: destinoAndar.id, tile: tileDoAndar(destinoAndar, c) },
        );
        for (const etapa of rota.etapas) {
          if (etapa.tipo !== 'andar') continue;
          const andar = porId.get(etapa.andar)!;
          for (const t of tilesDaEtapa(etapa)) {
            expect(t.ty, `${etapa.andar} ${t.tx},${t.ty}`).toBeGreaterThanOrEqual(andar.y0 + LAJE);
            expect(t.ty, `${etapa.andar} ${t.tx},${t.ty}`).toBeLessThan(andar.y1);
          }
        }
      }
    }
  });
});
