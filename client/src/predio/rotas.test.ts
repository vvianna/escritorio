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

const indiceAndar = (c: Cena, id: string): number => c.andares.findIndex((a) => a.id === id);

function expectTrechoAndar(
  etapa: EtapaRota,
  andar: AndarCena,
  de: Tile,
  para: Tile,
): asserts etapa is Extract<EtapaRota, { tipo: 'andar' }> {
  expect(etapa).toMatchObject({ tipo: 'andar', andar: andar.id, de, para });
  const caminho = (etapa as Extract<EtapaRota, { tipo: 'andar' }>).caminho;
  if (de.tx !== para.tx || de.ty !== para.ty) expect(caminho.at(-1)).toEqual(para);
}

function expectRoteiro(
  c: Cena,
  origemAndar: AndarCena,
  origem: Tile,
  destinoAndar: AndarCena,
  destino: Tile,
): EtapaRota[] {
  const rota = rotaPredio(
    c,
    { andar: origemAndar.id, tile: origem },
    { andar: destinoAndar.id, tile: destino },
  );

  if (origemAndar.id === destinoAndar.id) {
    expect(rota.etapas.map((e) => e.tipo), origemAndar.id).toEqual(['andar']);
    expectTrechoAndar(rota.etapas[0]!, origemAndar, origem, destino);
    return rota.etapas;
  }

  const msg = `${origemAndar.id} → ${destinoAndar.id}`;
  expect(rota.etapas.map((e) => e.tipo), msg).toEqual(['andar', 'fila', 'embarque', 'desembarque', 'andar']);
  expectTrechoAndar(rota.etapas[0]!, origemAndar, origem, c.paradas[origemAndar.id].porta);
  expect(rota.etapas[1], msg).toEqual({
    tipo: 'fila',
    andar: origemAndar.id,
    porta: c.paradas[origemAndar.id].porta,
    fila: c.paradas[origemAndar.id].fila,
  });
  expect(rota.etapas[2], msg).toEqual({
    tipo: 'embarque',
    andar: origemAndar.id,
    indiceAndar: indiceAndar(c, origemAndar.id),
    porta: c.paradas[origemAndar.id].porta,
  });
  expect(rota.etapas[3], msg).toEqual({
    tipo: 'desembarque',
    andar: destinoAndar.id,
    indiceAndar: indiceAndar(c, destinoAndar.id),
    porta: c.paradas[destinoAndar.id].porta,
  });
  expectTrechoAndar(rota.etapas[4]!, destinoAndar, c.paradas[destinoAndar.id].porta, destino);
  return rota.etapas;
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
    const origemAndar = c.andares.find((a) => a.id === 'ti')!;
    const destinoAndar = c.andares.find((a) => a.id === 'produto')!;
    const origem = tileDoAndar(origemAndar, c);
    const destino = tileDoAndar(destinoAndar, c);

    expectRoteiro(c, origemAndar, origem, destinoAndar, destino);
  });

  it('todos os pares em andares diferentes seguem o roteiro completo do elevador', () => {
    const c = cena();

    for (const origemAndar of c.andares) {
      for (const destinoAndar of c.andares) {
        if (origemAndar.id === destinoAndar.id) continue;
        expectRoteiro(
          c,
          origemAndar,
          tileDoAndar(origemAndar, c),
          destinoAndar,
          tileDoAndar(destinoAndar, c),
        );
      }
    }
  });

  it('passeio à toa cobre todos os destinos de passeio a partir de cada andar', () => {
    const c = cena();

    for (const origemAndar of c.andares) {
      const origem = tileDoAndar(origemAndar, c);
      for (const destinoAndar of c.andares) {
        for (const destinoArea of destinoAndar.passeio) {
          expectRoteiro(
            c,
            origemAndar,
            origem,
            destinoAndar,
            primeiroTile(destinoArea, c, c.paradas[destinoAndar.id].porta),
          );
        }
      }
    }
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
