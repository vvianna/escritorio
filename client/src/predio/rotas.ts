import type { AndarId } from '../ui/predio-model';
import { PathFinder } from '../world/path/astar';
import { ElevadorPredio } from './elevador';
import type { Cena, Tile } from './planta';

export interface PontoPredio {
  andar: AndarId;
  tile: Tile;
}

export type EtapaRota =
  | { tipo: 'andar'; andar: AndarId; de: Tile; para: Tile; caminho: Tile[] }
  | { tipo: 'fila'; andar: AndarId; porta: Tile; fila: Tile[] }
  | { tipo: 'embarque'; andar: AndarId; indiceAndar: number; porta: Tile }
  | { tipo: 'desembarque'; andar: AndarId; indiceAndar: number; porta: Tile };

export interface RotaPredio {
  origem: PontoPredio;
  destino: PontoPredio;
  etapas: EtapaRota[];
}

/**
 * Roteiro puro entre dois tiles do prédio. Entre andares, ninguém cruza laje/hall cru: anda até a porta,
 * entra na fila, embarca no elevador, desembarca no destino e só então volta a andar no andar final.
 */
export function rotaPredio(cena: Cena, origem: PontoPredio, destino: PontoPredio): RotaPredio {
  const origemAndar = andarDaCena(cena, origem.andar);
  const destinoAndar = andarDaCena(cena, destino.andar);
  const pf = new PathFinder(cena.grid);

  if (origem.andar === destino.andar) {
    return { origem, destino, etapas: [etapaAndar(pf, origem.andar, origem.tile, destino.tile)] };
  }

  const de = indiceAndar(cena, origem.andar);
  const para = indiceAndar(cena, destino.andar);
  const elevador = new ElevadorPredio(cena.andares.length, de);
  elevador.chamar('__rota__', de, para);
  const eventos = elevador.resolverTudo();
  const embarque = eventos.find((e) => e.tipo === 'embarcou' && e.id === '__rota__');
  const desembarque = eventos.find((e) => e.tipo === 'desembarcou' && e.id === '__rota__');
  if (!embarque || !desembarque) throw new Error(`elevador não gerou ${origem.andar} → ${destino.andar}`);

  const portaOrigem = cena.paradas[origemAndar.id].porta;
  const portaDestino = cena.paradas[destinoAndar.id].porta;
  return {
    origem,
    destino,
    etapas: [
      etapaAndar(pf, origem.andar, origem.tile, portaOrigem),
      { tipo: 'fila', andar: origem.andar, porta: portaOrigem, fila: [...cena.paradas[origem.andar].fila] },
      { tipo: 'embarque', andar: origem.andar, indiceAndar: embarque.andar, porta: portaOrigem },
      { tipo: 'desembarque', andar: destino.andar, indiceAndar: desembarque.andar, porta: portaDestino },
      etapaAndar(pf, destino.andar, portaDestino, destino.tile),
    ],
  };
}

function etapaAndar(pf: PathFinder, andar: AndarId, de: Tile, para: Tile): EtapaRota {
  const bruto: number[] = [];
  if (!pf.find(de.tx, de.ty, para.tx, para.ty, bruto)) {
    throw new Error(`sem caminho no andar ${andar}: ${de.tx},${de.ty} → ${para.tx},${para.ty}`);
  }
  const caminho: Tile[] = [];
  for (let i = 0; i < bruto.length; i += 2) caminho.push({ tx: bruto[i]!, ty: bruto[i + 1]! });
  return { tipo: 'andar', andar, de, para, caminho };
}

function andarDaCena(cena: Cena, id: AndarId) {
  const andar = cena.andares.find((a) => a.id === id);
  if (!andar) throw new Error(`andar desconhecido: ${id}`);
  return andar;
}

function indiceAndar(cena: Cena, id: AndarId): number {
  const i = cena.andares.findIndex((a) => a.id === id);
  if (i < 0) throw new Error(`andar desconhecido: ${id}`);
  return i;
}
