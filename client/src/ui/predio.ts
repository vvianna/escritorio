// Janela "Prédio": o time do Hermes por andar (escritorio.md) com o uso por assinatura no topo.
// Abre pelo botão da barra superior ou com ?predio na URL (fica lembrado). Enquanto aberta, busca
// GET /api/hermes/uso a cada 30 s (404 = fonte desligada; o prédio mostra só o que o snapshot tiver).
// No ?mock=1 usa os dados de exemplo de predio-model.ts.
import type { HermesModelo } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden } from './dom';
import { seloModelo } from './hermes-selo';
import {
  exemploPredio,
  montarPredio,
  ROTULO_ESTADO,
  tokensCurto,
  type AgentePredio,
  type FonteUso,
  type Ocupante,
  type PredioVista,
  type UsoHermes,
} from './predio-model';

const USO_MS = 30_000;
const CHAVE = 'escritorio.predio';

/** Prédio de 4 andares em pixels. */
const PREDIO_ICON =
  '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M2 0h6v10H6V8H4v2H2zM3 1v1h1V1zm3 0v1h1V1zM3 3v1h1V3zm3 0v1h1V3zM3 5v1h1V5zm3 0v1h1V5z"/></svg>';

const ICONE: Record<Ocupante['estado'], string> = {
  running: '⌨️',
  blocked: '✋',
  guarded: '🛑',
  delivering: '📦',
  cafe: '☕',
  conversando: '💬',
  fora: '·',
};

export class PredioPanel implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private body: HTMLElement;
  private uso: UsoHermes | null = null;
  private fonte: FonteUso = 'carregando';
  private timer: ReturnType<typeof setInterval> | null = null;
  private assinatura = '';
  private aberto = false;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(PREDIO_ICON, 'Prédio: o time por andar e o uso por assinatura', () => this.toggle());
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.body = h('div', { class: 'predio__corpo' });
    const fechar = h('button', { class: 'predio__fechar', type: 'button', text: '×', title: 'Fechar o prédio', attrs: { 'aria-label': 'Fechar o prédio' }, on: { click: () => this.close() } });
    this.el = h('section', { class: 'predio', role: 'dialog', attrs: { 'aria-label': 'Prédio do time', 'data-testid': 'predio' }, hidden: true }, fechar, this.body);
    const pedido = typeof location !== 'undefined' && new URLSearchParams(location.search).has('predio');
    let lembrado = false;
    try {
      lembrado = localStorage.getItem(CHAVE) === '1';
    } catch {
      // sem localStorage
    }
    // Ainda dentro do createUI: nada de invalidate() aqui (o primeiro quadro desenha tudo).
    if (pedido || lembrado) this.open(false);
  }

  toggle(): void {
    if (this.aberto) this.close();
    else this.open();
  }

  open(redesenhar = true): void {
    this.aberto = true;
    this.lembrar();
    setHidden(this.el, false);
    this.button.classList.add('is-active');
    this.button.setAttribute('aria-pressed', 'true');
    if (this.ctx.store.mock) this.uso = exemploPredio().uso;
    else {
      void this.buscarUso();
      this.timer ??= setInterval(() => void this.buscarUso(), USO_MS);
    }
    this.assinatura = '';
    if (redesenhar) this.ctx.invalidate();
  }

  close(): void {
    this.aberto = false;
    this.lembrar();
    setHidden(this.el, true);
    this.button.classList.remove('is-active');
    this.button.setAttribute('aria-pressed', 'false');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private lembrar(): void {
    try {
      localStorage.setItem(CHAVE, this.aberto ? '1' : '0');
    } catch {
      // sem localStorage
    }
  }

  private async buscarUso(): Promise<void> {
    try {
      const r = await fetch('/api/hermes/uso', { headers: { accept: 'application/json' } });
      if (r.ok) {
        this.uso = (await r.json()) as UsoHermes;
        this.fonte = 'ok';
      } else if (r.status === 404) {
        this.uso = null;
        this.fonte = 'desligada';
      } else this.fonte = 'erro'; // fica o último uso lido
    } catch {
      this.fonte = 'erro';
    }
    this.ctx.invalidate();
  }

  render(): void {
    if (!this.aberto) return;
    let agentes = (this.ctx.store.snapshot?.agents ?? []) as unknown as AgentePredio[];
    if (this.ctx.store.mock && !agentes.some((a) => a.provider === 'hermes')) agentes = exemploPredio().agentes;
    const vista = montarPredio(agentes, this.uso, this.ctx.store.mock ? 'ok' : this.fonte);
    const assinatura = JSON.stringify(vista);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    this.body.replaceChildren(...this.desenhar(vista));
  }

  private desenhar(v: PredioVista): HTMLElement[] {
    const uso = h(
      'div',
      { class: 'predio__uso', attrs: { 'data-testid': 'predio-uso' } },
      h('div', { class: 'predio__uso-titulo', text: 'Uso por assinatura' }),
      h(
        'table',
        { class: 'predio__tabela' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: '5 h' }), h('th', { text: '7 dias' }), h('th', { text: 'US$ 7 d', title: 'Custo estimado (o que a API cobraria); na assinatura é referência de peso' }))),
        h(
          'tbody',
          {},
          ...v.uso.map((l) =>
            h(
              'tr',
              { class: l.seteDias ? '' : 'is-zero' },
              h('th', { text: l.rotulo }),
              h('td', { text: tokensCurto(l.cincoHoras) }),
              h('td', { text: tokensCurto(l.seteDias) }),
              h('td', { text: l.custo7dUsd ? l.custo7dUsd.toLocaleString('pt-BR', { maximumFractionDigits: l.custo7dUsd < 10 ? 2 : 0 }) : '—' }),
            ),
          ),
        ),
      ),
      v.cotas.length ? h('div', { class: 'predio__cotas', text: v.cotas.map((c) => `${c.familia} (${c.janela}): ${Math.round(c.restantePct)}% livre`).join(' · ') }) : null,
      v.aviso ? h('div', { class: 'predio__aviso', text: v.aviso }) : null,
    );
    const andares = v.andares.map((a) =>
      h(
        'div',
        { class: `predio__andar predio__andar--${a.id}`, attrs: { 'data-andar': a.id } },
        h('div', { class: 'predio__andar-titulo' }, h('span', { text: a.titulo }), a.placa ? h('span', { class: 'predio__placa', text: a.placa }) : null),
        h(
          'div',
          { class: 'predio__salas' },
          ...a.salas.map((s) =>
            h(
              'div',
              { class: 'predio__sala' },
              h('div', { class: 'predio__sala-nome', text: s.nome }),
              s.objeto ? h('div', { class: 'predio__objeto', text: s.objeto }) : null,
              ...(s.ocupantes.length ? s.ocupantes.map((o) => this.cracha(o)) : [h('div', { class: 'predio__vazia', text: 'vazia' })]),
            ),
          ),
        ),
      ),
    );
    const resumo = h('div', { class: 'predio__resumo', text: `${v.trabalhando} trabalhando · ${v.portoes} esperando você` });
    return [uso, resumo, ...andares];
  }

  private cracha(o: Ocupante): HTMLElement {
    const el = h(
      'div',
      { class: `predio__cracha is-${o.estado}`, title: `${o.nome}: ${ROTULO_ESTADO[o.estado]}${o.board ? ` · board ${o.board}` : ''}` },
      h('span', { class: 'predio__icone', text: ICONE[o.estado], attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'predio__nome' }, h('span', { text: o.nome }), o.modelo ? this.selo(o.modelo) : null),
      h('span', { class: 'predio__estado', text: ROTULO_ESTADO[o.estado] }),
      o.detalhe ? h('span', { class: 'predio__detalhe', text: o.board ? `${o.board} · ${o.detalhe}` : o.detalhe }) : null,
    );
    if (o.agentId && this.ctx.agent(o.agentId)) {
      el.classList.add('is-link');
      el.tabIndex = 0;
      const ir = () => {
        this.close();
        this.ctx.select({ type: 'agent', id: o.agentId! }, { focus: true });
      };
      el.addEventListener('click', ir);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ir();
      });
    }
    return el;
  }

  /** Selo de provedor/modelo da cadeira (cor da assinatura; laranja "↪ reserva" na reserva; modelo no hover). */
  private selo(m: HermesModelo): HTMLElement {
    const s = seloModelo(m);
    return h('span', { class: `ui-hsel ui-hsel--${s.variante}`, text: s.texto, title: s.titulo, attrs: { 'data-testid': 'predio-selo' } });
  }
}
