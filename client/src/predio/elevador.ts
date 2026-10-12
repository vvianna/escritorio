// Elevador do prédio vertical: máquina de estados pura da cabine (sem DOM), coletivo simples (spec D5).
// Andares por índice: 0 = Cobertura … n-1 = Térreo.

export const CAPACIDADE = 3;
export const ANDAR_MS = 900; // tempo da cabine entre paradas vizinhas (com aceleração e freio)
export const PORTA_MS = 450; // 0 → 4 (mesmo ritmo de DOOR_SPEED em world/sim/elevator.ts)
export const SEGURA_MS = 650; // porta aberta depois do último que entra/sai (HOLD_MS)
/** Tempo de cada pessoa saindo ou entrando (uma a uma). */
export const PASSO_MS = 300;
/** Folga de ponto flutuante (ms) ao fechar porta e chegar no andar. */
const EPS = 1e-6;

export type Evento =
  | { tipo: "embarcou"; id: string; andar: number }
  | { tipo: "desembarcou"; id: string; andar: number }
  | { tipo: "porta"; andar: number; aberta: boolean };

interface Passageiro {
  id: string;
  para: number;
}

type Estado = "parada" | "andando" | "abrindo" | "aberta" | "fechando";

export class ElevadorPredio {
  private estado: Estado = "parada";
  private andar: number;
  private alvo = 0;
  private origem = 0;
  private t = 0; // ms já andados na viagem atual
  private sentido = 0; // -1 sobe (índice menor), +1 desce, 0 sem sentido
  private prox = 0; // ms até a próxima pessoa poder sair/entrar
  private ocioso = 0; // ms desde o último movimento de pessoa com a porta aberta
  private filas: Passageiro[][];
  private cabine: Passageiro[] = [];
  private _porta = 0;

  constructor(
    private readonly nAndares: number,
    inicial = nAndares - 1,
  ) {
    this.andar = inicial;
    this.filas = Array.from({ length: nAndares }, () => []);
  }

  get posicao(): number {
    if (this.estado !== "andando") return this.andar;
    const dur = Math.abs(this.alvo - this.origem) * ANDAR_MS;
    const x = this.t / dur;
    return this.origem + (this.alvo - this.origem) * x * x * (3 - 2 * x);
  }

  /** 0 (fechada) .. 4 (aberta), para o sprite. */
  get porta(): number {
    return this._porta;
  }

  get carga(): readonly string[] {
    return this.cabine.map((p) => p.id);
  }

  fila(andar: number): readonly string[] {
    return (this.filas[andar] ?? []).map((p) => p.id);
  }

  chamar(id: string, de: number, para: number): void {
    if (de === para) return;
    this.filas[de].push({ id, para });
  }

  tick(dtMs: number): Evento[] {
    const ev: Evento[] = [];
    let resto = dtMs;
    // Cada passo consome parte do tempo; 1000 voltas é folga para qualquer dt razoável.
    for (let i = 0; i < 1000 && resto > 0; i++) resto = this.passo(resto, ev);
    return ev;
  }

  resolverTudo(): Evento[] {
    const ev: Evento[] = [];
    for (const p of this.cabine)
      ev.push({ tipo: "desembarcou", id: p.id, andar: p.para });
    this.filas.forEach((fila, de) => {
      for (const p of fila) {
        ev.push({ tipo: "embarcou", id: p.id, andar: de });
        ev.push({ tipo: "desembarcou", id: p.id, andar: p.para });
      }
    });
    if (this.estado === "andando") this.andar = this.alvo;
    this.cabine = [];
    this.filas = this.filas.map(() => []);
    this.estado = "parada";
    this._porta = 0;
    this.sentido = 0;
    return ev;
  }

  /** Alguém desce aqui, ou espera aqui e cabe na cabine. */
  private temServico(andar: number): boolean {
    return (
      this.cabine.some((p) => p.para === andar) ||
      (this.filas[andar].length > 0 && this.cabine.length < CAPACIDADE)
    );
  }

  /** Regra 3: mais perto no sentido atual; sem nenhum, inverte; sem nenhum, null. Decidida na saída da cabine. */
  private proximaParada(): number | null {
    const a = this.andar;
    const pedidos: number[] = [];
    for (let f = 0; f < this.nAndares; f++)
      if (f !== a && this.temServico(f)) pedidos.push(f);
    if (pedidos.length === 0) return null;
    const maisPerto = (s: number) =>
      pedidos
        .filter((f) => (f - a) * s > 0)
        .sort((x, y) => Math.abs(x - a) - Math.abs(y - a))[0];
    const s = this.sentido || -1;
    const alvo = maisPerto(s) ?? maisPerto(-s);
    this.sentido = Math.sign(alvo - a);
    return alvo;
  }

  private passo(resto: number, ev: Evento[]): number {
    switch (this.estado) {
      case "parada": {
        if (this.temServico(this.andar)) {
          this.estado = "abrindo";
          return resto;
        }
        const alvo = this.proximaParada();
        if (alvo === null) {
          this.sentido = 0;
          return 0;
        }
        this.estado = "andando";
        this.origem = this.andar;
        this.alvo = alvo;
        this.t = 0;
        return resto;
      }
      case "andando": {
        const falta = Math.abs(this.alvo - this.origem) * ANDAR_MS - this.t;
        if (resto < falta - EPS) {
          this.t += resto;
          return 0;
        }
        this.andar = this.alvo;
        this.estado = "parada";
        return resto - falta;
      }
      case "abrindo": {
        const falta = ((4 - this._porta) / 4) * PORTA_MS;
        if (resto < falta - EPS) {
          this._porta += (resto / PORTA_MS) * 4;
          return 0;
        }
        this._porta = 4;
        this.estado = "aberta";
        this.prox = 0;
        this.ocioso = 0;
        ev.push({ tipo: "porta", andar: this.andar, aberta: true });
        return resto - falta;
      }
      case "aberta": {
        if (this.prox > 0) {
          const c = Math.min(resto, this.prox);
          this.prox -= c;
          this.ocioso += c;
          return resto - c;
        }
        const sai = this.cabine.findIndex((p) => p.para === this.andar);
        if (sai >= 0) {
          const [p] = this.cabine.splice(sai, 1);
          ev.push({ tipo: "desembarcou", id: p.id, andar: this.andar });
          this.prox = PASSO_MS;
          this.ocioso = 0;
          return resto;
        }
        const fila = this.filas[this.andar];
        if (fila.length > 0 && this.cabine.length < CAPACIDADE) {
          const p = fila.shift()!;
          this.cabine.push(p);
          ev.push({ tipo: "embarcou", id: p.id, andar: this.andar });
          this.prox = PASSO_MS;
          this.ocioso = 0;
          return resto;
        }
        const falta = SEGURA_MS - this.ocioso;
        if (resto < falta) {
          this.ocioso += resto;
          return 0;
        }
        this.estado = "fechando";
        return resto - falta;
      }
      case "fechando": {
        if (
          this.filas[this.andar].length > 0 &&
          this.cabine.length < CAPACIDADE
        ) {
          this.estado = "abrindo"; // chegou alguém na porta: reabre
          return resto;
        }
        const falta = (this._porta / 4) * PORTA_MS;
        if (resto < falta - EPS) {
          this._porta -= (resto / PORTA_MS) * 4;
          return 0;
        }
        this._porta = 0;
        this.estado = "parada";
        ev.push({ tipo: "porta", andar: this.andar, aberta: false });
        return resto - falta;
      }
    }
  }
}
