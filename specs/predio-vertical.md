# SPEC: Prédio vertical (2ª vista "Salas | Prédio") com elevador entre os andares

**Slug:** `predio-vertical`  ·  **Prioridade:** normal  ·  **Worker:** dev  ·  **Reviewer:** reviewer  ·  **QA:** qa  ·  **Design:** designer
**Tela:** nova  ·  **Board:** `escritorio`  ·  **Cartão da spec:** `t_2925b5f4`  ·  **Protótipo:** `t_5189a13c` (branch `prototipo/predio-vertical`, commit `d5311b4`)

> Não é SENSÍVEL: não mexe com dinheiro, login, rede ou permissões. A única leitura nova do servidor é a coluna
> `tasks.created_by` dos kanban.db (já abertos só leitura, `mode=ro`), e ela só sai para o cliente quando é um nome de
> perfil (regex na fatia S4). Nenhum conteúdo de conversa de persona entra. Por isso sem `Judge`/`Auditor`.
>
> Mocks e diagramas: `specs/predio-vertical/` (comece por `planta.md`, depois `fluxos.md` e `coluna-elevador-375.html`).

## Perguntas abertas (o Victor decide no portão B; segui a opção mais simples, marcada [ASSUMIDO])

1. **A escada é só cenário?** [ASSUMIDO] sim: a escada aparece ao lado do poço do elevador, ligando os andares, mas
   ninguém sobe por ela. Todo mundo usa o elevador (com fila na porta). Usar a escada quando a fila passar de N pessoas
   fica para depois.
2. **A janela do botão de prédio (barra de cima) continua igual?** [ASSUMIDO] sim, sem mudar nada: uso por assinatura
   no topo e, embaixo, a lista de andares que já existe (`client/src/ui/predio.ts`). Tirar a lista de andares da janela,
   deixando só o uso, é outro cartão se o Victor quiser.
3. **De que lado fica o elevador?** [ASSUMIDO] à direita do prédio (lado leste), colado nas salas da direita.
4. **O Manager sobe por qualquer cartão parado?** [ASSUMIDO] só quando aparece um portão novo (cartão `blocked`
   esperando o Victor, o mesmo que levanta a mão hoje). O amarelo "Manager resolvendo" (`internal`) não faz ninguém subir.

## Objetivo

O escritório passa a ter duas vistas, trocadas pelo botão "Salas | Prédio" logo abaixo da barra de cima e lembradas no
aparelho. **Salas** é o mapa do Habblaud de hoje, sem mudança nenhuma. **Prédio** é o mesmo mapinha (mesma arte e o
mesmo motor de `client/src/world`), mas com os andares do time empilhados na vertical. Cada andar tem zoom (+ e −,
ou tocar no andar), e os bonecos mudam de andar por um **elevador em pixel art**, com a escada ao lado.

## Histórias de usuário

- Como Victor, no celular, quero tocar em "Prédio" e rolar o time de cima a baixo, para ver em 5 s quem está
  trabalhando e quem levantou a mão, no mesmo mapinha de sempre.
- Como Victor, quero continuar tendo as salas originais a um toque ("gosto mais de ter as 2 opções").
- Como Victor, quero ver o boneco ir até o elevador, subir ou descer e sair no andar certo quando um cartão muda de
  andar, quando uma persona manda pedido ao time ou quando o Manager me leva um portão ("como os bonecos vão
  transitar entre os andares").
- Como Victor, quero tocar num andar e ver a sala inteira no celular, com o nome de cada um legível e fora dos móveis.

## Contexto

- **Escolha do Victor no portão B (literal):** "Mas como os bonecos vão transitar entre os andares. E gosto mais de ter
  as 2 opções. Deixar a sala original e o prédio personalizado para a gente". Antes, sobre o protótipo: "Eu penso algo
  parecido com com o mapinha das sala, mas na vertical."
- **Decisões do Manager (cartão `t_2925b5f4`):** (1) opção B: salas originais intactas + Prédio como 2ª vista, botão
  "Salas | Prédio" embaixo da barra, lembrado no aparelho, zoom + e −, e tocar num andar aproxima; (2) elevador em
  pixel art na lateral, ligando todos os andares, escada ao lado; o boneco anda até o elevador, a porta abre, a cabine
  sobe ou desce, ele sai no andar novo e anda até a mesa; 📦 de mão em mão pelo elevador; fila na porta, no máximo 3 na
  cabine; fora da tela ou com a aba escondida, pula a animação e só reposiciona; (3) no zoom do andar nada cortado na
  borda (a sala inteira cabe em 375 px) e nome/selo nunca em cima de móvel; (4) mesmo renderizador e mesma arte das
  salas; não é painel de cartões nem tabela; o uso por assinatura continua na janela que já existe.
- **O que já existe e é reaproveitado:**
  - `client/src/ui/predio-model.ts`: `PLANTA` (andares e salas por perfil), `montarPredio(agentes, uso, fonte)` →
    `PredioVista`, `salaDe(perfil)`, `PERSONAS`, `ROTULO_ESTADO`, `exemploPredio()` (dados do `?mock=1`). **Não muda**
    (só ganha o campo opcional `criadoPor` em `AgentePredio.hermes`, fatia S3).
  - `client/src/ui/predio.ts` (`PredioPanel`): a janela do botão de prédio na barra (uso por assinatura + andares).
    **Não muda.**
  - `client/src/ui/hermes-selo.ts` (`seloModelo`): texto, cor e título do selo de modelo.
  - `client/src/world/layout/*` (`layoutProjectRoom`, `layoutCafe`, `layoutReception`, `layoutCorridor`,
    `AreaBuilder`, `paintArea`, `EXTERIOR_WALL`), `client/src/world/render/scene.ts` (`buildAreaVis`,
    `furnitureSprites`, `wallSprites`, `wallItemOrigin`, `opaqueBounds`, `WALL_MARGIN`),
    `client/src/world/render/props.ts` (`propSprite`, `carSprite`, `shadowSprite`), `client/src/world/path/*`
    (`PathFinder`, `WalkGrid`), `client/src/world/sim/elevator.ts` (tempos da porta: `DOOR_SPEED` 9 estados/s,
    `HOLD_MS` 650). **Só importados; nada em `client/src/world` muda.**
  - O protótipo `client/src/prototipo/predio-vertical.ts` (1271 linhas, só no branch `prototipo/predio-vertical`,
    nunca mergeado): é a referência de código para montar a cena (`mover`, `plantaVertical`, `montarCena`,
    `criarBonecos`, `passoBoneco`, `desenhar`, `posicionarRotulos`, CSS `.pv-*`). As fatias **copiam e organizam**
    esse código em `client/src/predio/`; não fazem merge do branch. Para ler:
    `git show origin/prototipo/predio-vertical:client/src/prototipo/predio-vertical.ts`.
  - Fonte do Hermes no servidor: `server/sources/hermes.ts` (lê `tasks`, `task_runs`, `task_events`,
    `task_comments` dos kanban.db só leitura). Cada agente `provider: 'hermes'` traz `hermes: HermesCard`
    (`shared/types.ts`: `board`, `taskId`, `title`, `state`, `reason`, `nota`), `hermesProfile` e `hermesSlot`
    (um personagem por trabalhador).
- **De onde vem o "mudou de andar"** (tudo no cliente, comparando um snapshot com o anterior; o servidor só ganha
  `criadoPor`): ver "Decisões de design › Viagens".
- **Problemas do protótipo que esta entrega corrige** (vistos nos prints `375-b.png` e `375-b-zoom.png`): no zoom do
  celular as salas ficam cortadas nas duas bordas; crachás ("produto · GEMINI", "vini-chat", "plantão") ficam em cima
  de mesa, estante e mesa de reunião.

## Como deve parecer / O que NÃO é

**Como deve parecer (Victor, literal):** "Eu penso algo parecido com com o mapinha das sala, mas na vertical." e
"Deixar a sala original e o prédio personalizado para a gente".

**Referência:** os prints do protótipo no branch `prototipo/predio-vertical`, pasta `prototipo/predio-vertical/`:
`375-b.png` (Prédio no celular), `375-b-salas.png` (Salas no celular), `375-b-zoom.png` (zoom; aqui está o que
corrigir), `1280-b.png` (PC). HTML offline: `prototipo-predio-vertical.html#opcao=b`. E o mapa de hoje do Habblaud
(`docs/screenshots/overview.png`).

**O que o olho vê primeiro:** o botão "Salas | Prédio" logo abaixo da barra de cima. No Prédio, um prédio em pé, em
pixel art, visto de cima como o mapa das salas: gramado dos lados, Cobertura · Negócio no topo (Mesa do Victor e
terraço, com a placa "✋ 1 portão" quando há portão), 3º · Produto (Produto e Copa), 2º · TI (as salas lado a lado,
duas por fileira, com corredor no meio), Térreo · Personas (Recepção e terraço) e a rua com carros embaixo. Na
lateral direita, de cima a baixo, uma coluna estreita: o hall de cada andar, o poço do elevador com a cabine e a
escada. Os bonecos digitam, levantam a mão, tomam café, andam; quando alguém muda de andar, anda até a porta do
elevador, a porta abre, a cabine desliza pelo poço até o outro andar, a porta abre e ele sai andando até a mesa.

**Forma geral:** uma cena contínua de pixel art que rola na vertical (≈ 2 telas no celular), sem moldura, sem lista.
Por cima da cena, só: as placas dos andares (botão de toque), o nome das salas na parede, o crachá (nome + selo) sobre
cada boneco, o estado por extenso só com zoom, e os botões + e − no canto de baixo à direita.

**O que NÃO é:**
- Não é painel de cartões, tabela, lista de andares nem miniaturas em fileira (o erro do primeiro protótipo,
  `t_f888b0ad`). Se a tela parece um dashboard, não está pronto.
- Não é corte lateral estilo Tiny Tower (paredes vistas de lado, andares como prateleiras). A vista é a de cima, a
  mesma das salas; a cabine anda pelo poço **na vertical da tela**, que no mapa é o eixo norte–sul.
- Não é outra arte: nada de sprite desenhado em HTML/CSS. A cabine, o poço e a escada são sprites novos do kit de
  `client/src/art`, na mesma paleta (S5).
- Não substitui as Salas: o mapa dos projetos continua idêntico e é o padrão na primeira vez.
- O uso por assinatura não entra na cena: fica na janela que já existe (botão de prédio na barra).

## Decisões de design

### D1. Duas vistas e onde fica o código

- Código novo em **`client/src/predio/`** (pasta nova; nada em `client/src/prototipo/`):

  | arquivo | o quê | puro? |
  | --- | --- | --- |
  | `planta.ts` | monta a cena vertical: andares, áreas movidas, coluna do elevador, grade de caminhada | sim (recebe `art`) |
  | `elevador.ts` | máquina de estados da cabine (fila, capacidade 3, paradas) | sim |
  | `viagens.ts` | compara snapshots e decide as viagens; `roteiroDemo()` | sim |
  | `enquadrar.ts` | escalas e rolagem: visão geral, zoom de sala, zoom de andar, + e − | sim |
  | `crachas.ts` | posição dos crachás desviando de móvel, placa e outros crachás | sim |
  | `bonecos.ts` | personagens: mesa, passeio, entrega, viagem (usa `PathFinder`) | lógica pura + estado |
  | `render.ts` | desenho no canvas (o `desenhar` do protótipo + cabine/poço/escada) | não (canvas) |
  | `vista.ts` | `VistaPredio implements UiComponent`: DOM, alternador, zoom, toque, loop, `window.__predio` | não (DOM) |

- `client/src/ui/index.ts`: cria `new VistaPredio(ctx)` depois do `topbar`, põe `vista.el` no `root.append(...)` e
  em `components`. Nada mais muda na UI.
- CSS: seção nova `/* ---- Prédio vertical (client/src/predio) ---- */` no fim de `client/src/ui/styles.css`, com as
  classes do protótipo renomeadas de `.pv-*` para `.pred-*` (`.pred-camada`, `.pred-palco`, `.pred-tela`,
  `.pred-rotulos`, `.pred-rot`, `.pred-selo`, `.pred-sala`, `.pred-andar`, `.pred-alterna`, `.pred-zoom`,
  `.pred-btn`). Sem `<style>` injetado por JS. A faixa "PROTÓTIPO Opção A | Opção B" **não** entra.
- **Alternador "Salas | Prédio"**: `div.pred-alterna[role=group][aria-label="Vista"]` com 2 `button` (`aria-pressed`),
  fixo, centralizado, 8 px abaixo da base da barra de cima (posição recalculada por `ResizeObserver` no `topbar.el`,
  como no protótipo). Alvos ≥ 44 px.
- **Lembrar a vista**: `localStorage['escritorio.vista']` = `'salas' | 'predio'`; sem valor = `'salas'` (como hoje).
  `?vista=predio` ou `?vista=salas` na URL vence o guardado e também é gravado. Sem `localStorage`, funciona sem lembrar.
- **Salas ativa**: a camada do Prédio fica `hidden`, o loop do Prédio **para** (nenhum `requestAnimationFrame`) e as
  viagens que surgirem são resolvidas na hora (D6). O mundo `#world` segue como hoje.
- **Prédio ativo**: `.pred-camada` cobre a área abaixo da barra (`position: fixed; z-index: 40`, como `.pv-camada`).
  Os painéis da UI que abrem por cima (gaveta, configurações, a janela de prédio) continuam acima dela.

### D2. Planta vertical (coordenadas em tiles; `TILE` = 16 px)

Detalhe e desenho em `specs/predio-vertical/planta.md`. Constantes exportadas de `planta.ts`:

| constante | valor | o quê |
| --- | --- | --- |
| `BX` | 1 | gramado à esquerda do prédio |
| `BW` | 32 | prédio: 2 salas de 16 (`COL_W`) |
| `HALL_W` | 2 | hall de cada andar, colado no prédio (piso `concrete`, caminhável) |
| `POCO_W` | 3 | poço do elevador (a cabine tem 3 × 2 tiles) |
| `ESCADA_W` | 2 | escada (cenário) |
| `MARGEM_D` | 1 | gramado à direita |
| `WT` | 41 | largura total (`BX + BW + HALL_W + POCO_W + ESCADA_W + MARGEM_D`) = 656 px |
| `TOPO` | 6 | gramado acima do prédio |
| `LAJE` | 4 | faixa de tijolo entre andares, onde fica a placa do andar |

- Andares de cima para baixo, como no protótipo (`plantaVertical`): Cobertura (`victor` + terraço), 3º (`produto` +
  Copa), 2º TI (as salas de `PLANTA` do andar `ti` + `extra` se houver, em blocos de 4: fileira norte de 2, corredor,
  fileira sul de 2; o último bloco pode ter só a fileira norte), Térreo (Recepção + terraço). Depois, calçada (2 tiles),
  rua (4 tiles).
- **Coluna do elevador** à direita do prédio, de `x = BX + BW` (= 33) até `x = 40`:
  - hall `x 33..34`: uma área por andar (`AreaBuilder(`hall:${andar}`, 'corridor', …)`), do fim da laje (`y0 + LAJE`)
    até `y1`, piso `concrete`, toda caminhável;
  - poço `x 35..37`: contínuo do topo do prédio até o fim do Térreo (passa por cima das lajes); não caminhável;
  - escada `x 38..39`: contínua como o poço; não caminhável (cenário, pergunta aberta 1).
- **Corredores abertos para o hall**: em cada corredor movido (`layoutCorridor(2)`, largura local 32), tirar os
  `glass_partition` da ponta leste nas linhas locais `ly = 1..3` (`x local = 31`) e marcar esses 3 tiles como
  caminháveis. A ponta oeste continua de vidro. Todos os corredores de um andar (no TI são 3) dão no hall do andar.
- **Parada da cabine** em cada andar = linhas do **primeiro corredor** do andar: cabine em `y = cy + 1 .. cy + 2`
  (`cy` = `y` do corredor), porta no lado oeste da cabine. **Tile da porta** = `(34, cy + 2)`. **Fila** = tiles
  `(33, cy + 2)`, `(34, cy + 3)`, `(33, cy + 3)`, `(34, cy + 4)`, `(33, cy + 4)`, depois descendo pelo hall
  (`(34, cy + 5)`, `(33, cy + 5)`, …). Primeiro da fila = tile da porta.
- A Recepção do Térreo tem os elevadores de parede do Habblaud (`layoutReception`): ficam desenhados com a porta
  fechada (estado 0) e ninguém usa. O elevador do time é só o da coluna.
- A cena só é remontada quando muda o conjunto de salas (ex.: aparece a "Bancada extra"); a chave é
  `andares.map(a => a.salas.map(s => s.id).join(',')).join('|')`. Mudança de ocupante não remonta a cena.

### D3. Vista, zoom e toque

- **Visão geral**: `escalaVisao(W) = clamp(W / (WT * TILE), 0.5, 1.5)`. Em 375 px ≈ 0,57; em 1280 px = 1,5 (o prédio
  fica no meio do gramado). Só nome + selo nos crachás.
- **+ e −**: botões `.pred-zoom` no canto inferior direito, 44 × 44 px, `aria-label` "Aproximar" / "Afastar". Fator
  1,6 em volta do centro da tela, entre `escalaVisao(W)` e `ESCALA_MAX = 3`. Animação de 260 ms (sem animação com
  `prefers-reduced-motion: reduce`).
- **Tocar num andar** (na placa `.pred-andar`, que é `button`, ou em qualquer ponto do andar) aproxima, com animação de
  380 ms ancorada (a função `zoomPara` do protótipo):
  - tela estreita (`W < 700`): enquadra a **sala tocada** (a da esquerda se o toque foi na metade esquerda do prédio;
    a da direita se foi na metade direita ou na coluna do elevador; a placa enquadra a sala da esquerda do 1º bloco);
  - tela larga (`W ≥ 700`): enquadra o **andar inteiro** na largura (prédio + coluna do elevador).
  - Já com zoom, tocar numa sala não muda nada (arrasta-se para andar pela cena); tocar na placa de outro andar
    enquadra aquele andar; "−" até a visão geral volta ao normal.
- **Enquadramento sem corte** (`enquadrar.ts`): `enquadrarRet(ret, W, H, margem = 8)` devolve
  `{ escala, scrollLeft, scrollTop }` com `escala = min(ESCALA_MAX, (W − 2·margem) / ret.w)` e o retângulo inteiro
  dentro de `[margem, W − margem]` na horizontal; o topo do andar (`y0 + LAJE`) fica 60 px abaixo do topo da camada.
  Para uma sala (256 px de mundo) em 375 px: escala ≈ 1,40, a sala ocupa 359 px. Para o andar (`(BW + 7) × 16` =
  624 px) em 1280: escala ≈ 2,03.
- **Com zoom** (`escala > 1,4 × escalaVisao`), a classe `.pred-camada--detalhe` mostra o estado por extenso
  (`ROTULO_ESTADO`) debaixo do nome.
- **URL** (para QA e prints): `?andar=cobertura|produto|ti|terreo` abre já com zoom naquele andar;
  `&sala=<id da sala em PLANTA>` escolhe a sala no celular (ex.: `?vista=predio&andar=ti&sala=devs`).
- Rolagem nativa da camada (toque) e arrastar com o mouse, como no protótipo. Sem rolagem lateral na visão geral.

### D4. Crachás: nunca em cima de móvel, nunca cortados

- Crachá = `div.pred-rot` com nome curto (`nomeCurto` do protótipo) + selo (`seloModelo`; selo 11 px maiúsculo) e,
  com zoom, o estado. Texto ≥ 11 px.
- `posicionarCrachas(itens, obstaculos, limite)` em `crachas.ts`, pura, em px de tela:
  - `itens`: `{ id, cabeca: {x, y}, pes: {x, y}, w, h, sentado: boolean }`;
  - `obstaculos`: retângulos de tela de **todo móvel visível** (`opaqueBounds` do sprite base e do `front`, em px de
    tela), dos nomes de sala (`.pred-sala`), das placas de andar, da cabine e de crachás já postos;
  - `limite`: a área visível da camada menos 4 px de cada lado.
  - Ordem de tentativa para cada crachá (sentados primeiro, depois quem anda, por `y`): (1) centrado acima da cabeça,
    4 px de folga; (2) centrado abaixo dos pés; (3) à esquerda da cabeça; (4) à direita; (5) as posições 1 e 2
    deslocadas em passos de 4 px até 48 px. Fica a primeira que não encosta em nenhum obstáculo e cabe no `limite`.
    Se nenhuma serve, fica a de menor área sobreposta e conta em `sobreMovel` (ver `window.__predio`).
  - Saída: `{ id, x, y, sobreposicao: number }[]`.
- O `x` final é sempre preso a `[limite.x, limite.x + limite.w − w]` (crachá nunca cortado na borda).
- Boneco dentro da cabine: sem crachá (só o ícone 📦 sobre a cabine, se alguém leva caixa).

### D5. Elevador (`elevador.ts`, puro)

```ts
export const CAPACIDADE = 3;
export const ANDAR_MS = 900;        // tempo da cabine entre paradas vizinhas (com aceleração e freio)
export const PORTA_MS = 450;        // 0 → 4 (mesmo ritmo de DOOR_SPEED em world/sim/elevator.ts)
export const SEGURA_MS = 650;       // porta aberta depois do último que entra/sai (HOLD_MS)
export type Evento =
  | { tipo: 'embarcou'; id: string; andar: number }
  | { tipo: 'desembarcou'; id: string; andar: number }
  | { tipo: 'porta'; andar: number; aberta: boolean };
export class ElevadorPredio {
  constructor(nAndares: number, inicial?: number);  // andares por índice: 0 = Cobertura … n-1 = Térreo; inicial = Térreo
  chamar(id: string, de: number, para: number): void; // o passageiro chegou ao tile da porta (ou à fila) do andar `de`
  tick(dtMs: number): Evento[];
  resolverTudo(): Evento[];       // pula a animação: todos (fila e cabine) desembarcam no destino, na hora
  readonly posicao: number;       // andar fracionário, para desenhar a cabine entre paradas
  readonly porta: number;         // 0 (fechada) .. 4 (aberta), para o sprite
  readonly carga: readonly string[];
  fila(andar: number): readonly string[];
}
```

Regras (coletivo simples, o de prédio de verdade):
1. Parada: a cabine **abre** quando para num andar onde alguém desce ou alguém espera. Primeiro desembarca quem tem
   esse destino (um a um, 300 ms cada), depois embarca a fila **em ordem de chegada** até `CAPACIDADE`. Quem não coube
   continua na fila (mesma ordem).
2. Porta: abre em `PORTA_MS`, fica aberta `SEGURA_MS` depois do último movimento e fecha em `PORTA_MS`. A cabine só
   anda com a porta fechada.
3. Próxima parada: segue no sentido atual até o andar mais próximo que tenha destino de passageiro ou fila; sem
   nenhum nesse sentido, inverte; sem nenhum, fica parada de porta fechada onde está.
4. Sem fome: uma chamada nunca espera mais que `nAndares × 2` paradas (a regra 3 garante; teste cobre).
5. `chamar` com `de === para` não faz nada (o boneco não entra).

### D6. Viagens (`viagens.ts`, puro): quem muda de andar e por quê

`MemoriaCartoes.atualizar(agentes: AgentePredio[], agora: number): Viagem[]`. Guarda, por chave
`${board}/${taskId}`, `{ perfil, agentId, andar, estado, criadoPor?, vistoEm }`; o andar vem de `salaDe(perfil).andar`.
Esquece a chave 15 min (`MEMORIA_MS`) depois de deixar de vê-la. **A 1ª chamada só carrega a memória e devolve `[]`**
(abrir a página não dispara viagem).

```ts
export type Viagem =
  | { tipo: 'entrega'; chave: string; quem: string | null; dePerfil: string; paraPerfil: string; de: AndarId; para: AndarId; destino?: string }
  | { tipo: 'portao';  chave: string; quem: string; de: AndarId; para: 'cobertura' }
  | { tipo: 'persona'; chave: string; quem: string; paraPerfil: string; de: 'terreo'; para: AndarId; destino?: string };
```
(`quem`/`destino` = `agentId` do boneco que viaja / que recebe; para persona, `persona:<perfil>`, o id que
`montarPredio` já dá.)

1. **Entrega** (o cartão passa de um andar a outro, ex.: do dev da TI para o Produto): a chave estava com o perfil
   P (andar X) e agora está com o perfil Q (andar Y ≠ X). `quem` = o agente que mostrava a chave antes, se ainda
   está no snapshot; senão o personagem da função P (`hermesProfile === P` sem `hermesSlot`, ou `name === P`); senão
   `null`. `destino` = o agente que mostra a chave agora.
   Mesmo andar (ex.: dev → reviewer, ambos no TI): **sem viagem**, segue como hoje (estado `delivering`).
2. **Portão** (o Manager leva um portão ao Victor): aparece uma chave com estado `blocked` que antes não era
   `blocked` (ou é nova). `quem` = agente do perfil `default`. Várias no mesmo snapshot = 1 viagem. Se já há viagem de
   portão pendente ou andando, não cria outra. Sem Manager no snapshot, não há viagem.
3. **Persona** (uma persona sobe do Térreo com um pedido): chave **nunca vista** com `criadoPor ∈ PERSONAS` e
   perfil dono fora do Térreo. `quem` = `persona:<criadoPor>`. Sem `criadoPor` (servidor antigo) não há esta viagem.

Limites: no máximo 6 viagens pendentes (`MAX_PENDENTES`); as que passarem disso são resolvidas na hora (D7).

### D7. O que o boneco faz em cada viagem (`bonecos.ts`) e quando pula a animação

Sequência (desenho em `fluxos.md`):

- **Entrega com `quem`**: o boneco pega o 📦 (`held: 'box'`, ícone `box`), anda até o tile da porta do andar X (ou o
  fim da fila), `chamar(quem, X, Y)`, entra na cabine, viaja, sai no andar Y, anda até o **ponto de entrega** da mesa
  do `destino` (o tile caminhável mais perto, na frente da mesa: `grid.nearestWalkable` a partir do tile do spot
  `desk` deslocado 1 tile para o lado do corredor), para 1,5 s (`ENTREGA_MS`); o 📦 passa para o `destino`
  (`held: 'box'` por 2 s, depois volta ao estado dele). Sem `destino` no snapshot: deixa o 📦 na mesa livre da sala
  de Q (ícone `box` sobre a mesa por 10 s). Depois volta: porta do andar Y → cabine → andar X → mesa dele.
  Se o snapshot já não tem o boneco (trabalhador cujo cartão saiu de `running`), ele continua na cena até terminar a
  ida e, na volta, some ao entrar na cabine (porta fecha com ele). Limite: some em 60 s de qualquer jeito.
- **Entrega com `quem = null`** (📦 de mão em mão pelo elevador): o 📦 aparece no tile da porta do andar X e viaja
  sozinho na cabine (como passageiro `caixa:<chave>`); ao chegar ao andar Y, o `destino` (ou, sem ele, o boneco mais
  perto na sala de Q) anda da mesa até a porta, pega o 📦 e volta à mesa. Sem ninguém na sala de Q, o 📦 fica no tile
  da porta por 10 s e some.
- **Portão**: o Manager levanta da mesa (papéis na mão, `held: 'papers'`), elevador até a Cobertura, anda até o ponto
  de entrega da Mesa do Victor, fica 4 s (`PORTAO_MS`) com a pose `talk`; o Victor já está de mão levantada (regra de
  hoje). Volta à mesa do TI.
- **Persona**: a persona sai da Recepção com o 📦, elevador até o andar do dono, entrega na mesa do `destino` (ou na
  mesa livre da sala), volta à Recepção.
- Durante a viagem o boneco ignora o estado do cartão (não senta, não passeia); ao voltar, retoma o estado atual.
- **Pula a animação e só reposiciona** (`resolverViagem`: todos já onde terminariam, 📦 entregue, cabine fica onde
  estava, porta fechada; conta em `resolvidasSemAnimacao`) quando, **na hora em que a viagem começa**:
  1. `document.hidden` é `true`; ou
  2. a vista ativa é Salas; ou
  3. nem a sala de origem, nem a de destino, nem o trecho do poço entre os dois andares cruzam a área visível da
     camada; ou
  4. já há `MAX_PENDENTES` viagens pendentes.
  Viagem que já começou animada segue até o fim mesmo se a rolagem tirar ela da tela.
- **Aba volta** (`visibilitychange` para visível depois de > 5 s escondida, mesma regra de `world/index.ts`) ou
  **troca para Prédio**: `elevador.resolverTudo()` e todas as viagens em andamento terminam na hora.

### D8. Dados: `criadoPor` (único toque no servidor)

- `shared/types.ts`: `HermesCard` ganha `criadoPor?: string` ("perfil que criou o cartão, só quando é nome de perfil").
- `server/sources/hermes.ts`: a consulta de `tasks` (linhas 285 e 356) passa a ler também `created_by`; o
  `ProfileCard` só leva `criadoPor` quando `created_by` casa com `/^[a-z][a-z0-9-]{0,31}$/` (descarta `null`, vazio e
  qualquer coisa com `:`, `@`, espaço ou dígitos no começo). Atualizar o comentário do topo (lista de colunas lidas).
- `client/src/ui/predio-model.ts`: `AgentePredio.hermes` ganha `criadoPor?: string` (só tipo).

### D9. Desempenho e acessibilidade

- Desenho a 12 quadros/s (`FPS_MS = 1000 / 12`, como o protótipo), só o que está visível; a simulação dos bonecos e
  do elevador anda a cada `requestAnimationFrame` (dt limitado a 100 ms). Vista Salas ativa ou aba escondida: loop
  parado.
- Canvas com `aria-hidden="true"`; a camada é `role="region"` com `aria-label="Prédio do time (mapa vertical)"`. As
  placas dos andares são `button` com o texto do andar e o resumo ("7 trabalhando · ✋ 1"). Foco visível
  (`outline: 2px solid #7cc8ff`).
- Sem cor, fonte ou logo novas (base visual igual). Os sprites novos usam as cores de `client/src/art/theme.ts`.

### D10. Gancho de verificação `window.__predio`

Só com `?mock=1` ou `?debug=1` na URL. Somente leitura:

```ts
window.__predio = {
  vista(): 'salas' | 'predio';
  escala(): number;
  enquadramento(): { salaOuAndar: string; esquerda: number; direita: number; larguraTela: number } | null; // px de tela
  medirCrachas(): { total: number; sobreMovel: number; cortados: number };   // na tela atual
  elevador(): { posicao: number; porta: number; carga: string[]; filas: Record<AndarId, string[]> };
  viagens(): { pendentes: number; andando: number; feitas: number; resolvidasSemAnimacao: number };
};
```

### D11. Roteiro de demonstração (`?mock=1&vista=predio&viagens=demo`)

`roteiroDemo(t0)` em `viagens.ts` devolve `(agora) => AgentePredio[]` a partir de `exemploPredio().agentes`, num ciclo
de 36 s com 3 cenas de 12 s (para QA, designer e prints):
1. `0–12 s`: o cartão `escritorio/t_demo1` sai de "Santos Dumont (dev)" (TI, `running`) e passa para `produto`
   (`running`) → **entrega** TI → 3º.
2. `12–24 s`: o cartão do `architect` (`hermes-lab`, "Spec do painel de custos") passa de `running` a `blocked` →
   **portão**: o Manager sobe à Cobertura.
3. `24–36 s`: aparece `escritorio/t_demo3` no `produto`, `criadoPor: 'vini'` → **persona**: o vini sobe do Térreo.
Depois volta ao estado inicial (as chaves de demo saem) e repete. No `?mock=1` sem `viagens=demo`, nada muda.

## Telas (protótipo)

- **Links das opções:** opção A `prototipo-predio-vertical.html`, opção B `prototipo-predio-vertical.html#opcao=b`,
  em https://github.com/vvianna/escritorio/tree/prototipo/predio-vertical/prototipo/predio-vertical (abre offline;
  ao vivo no branch: `npm ci && npx vite --config vite.config.ts` → `/?mock=1&prototipo=predio-vertical&opcao=b`).
- **Prints:** `375-b.png`, `375-b-salas.png`, `375-b-zoom.png`, `1280-b.png` (opção B); `375-a.png`,
  `375-a-ti.png`, `375-a-zoom-ti.png`, `375-a-zoom-produto.png`, `375-a-terreo.png`, `1280-a.png`,
  `1280-a-zoom-ti.png` (opção A), na mesma pasta do branch.
- **Recomendação do designer:** opção A ("responde direto ao 'continuo vendo salas': o time aparece antes de qualquer
  toque e o detalhe fica a um toque, sem trocar de tela").
- **Escolha: no portão B** — já respondida pelo Victor: **opção B** (citação no Contexto), com o tocar-no-andar da A
  e o elevador. Esta spec segue a B.
- **Mock desta spec** (só o que o protótipo não tinha): `specs/predio-vertical/coluna-elevador-375.html` (a coluna
  hall | poço | escada e a fila na porta, em 375 px) e `specs/predio-vertical/planta.md`.

## Entregáveis

- [ ] `client/src/predio/planta.ts` + `planta.test.ts` (S1)
- [ ] `client/src/predio/elevador.ts` + `elevador.test.ts` (S2)
- [ ] `client/src/predio/viagens.ts` + `viagens.test.ts`; `criadoPor?` em `AgentePredio.hermes` (S3)
- [ ] `shared/types.ts` (`HermesCard.criadoPor?`), `server/sources/hermes.ts` (lê `created_by`) + testes em
      `server/sources/hermes.test.ts` (S4)
- [ ] sprites `elevatorCab`, `drawShaft`, `drawStairs` em `client/src/art/furniture/predio.ts`, exportados de forma
      aditiva em `client/src/art/api.ts`/`client/src/art/index.ts`, com teste em `client/src/art/art.test.ts` e no
      `client/art-preview.html` (S5)
- [ ] `client/src/predio/{bonecos,render,vista,enquadrar}.ts`, `client/src/ui/index.ts` (liga a vista),
      `client/src/ui/styles.css` (seção `.pred-*`) (S6, S7)
- [ ] `client/src/predio/crachas.ts` + `crachas.test.ts`, `enquadrar.test.ts`, gancho `window.__predio` (S7)
- [ ] viagens animadas na cena + `?viagens=demo` (S8)
- [ ] `README.md` (seção "Prédio do time" ganha a vista Prédio e o elevador), `CHANGELOG.md`, prints em
      `docs/screenshots/predio/` (S9)

## Definição de pronto (verificável — o worker DEVE executar e colar a evidência)

Em cada PR (no worktree do PR, depois de `npm ci`):
- [ ] `npm run typecheck` sai com código 0
- [ ] `npm test` sai com código 0 (inclui `client/src/predio/*.test.ts`)
- [ ] `npm run build` sai com código 0
- [ ] `git diff --name-only origin/main... | grep -E '^client/src/world/|^client/src/prototipo/|\.env|docker-compose'`
      não imprime nada

Ao final do plano (S8/S9), com `npx vite --config vite.config.ts --port 5173` rodando:
- [ ] `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1" /tmp/pred-salas.png --size 375x812 --wait 3000 --eval "window.__predio.vista()"`
      imprime `eval => salas` (1ª vez abre em Salas)
- [ ] `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1&vista=predio" /tmp/pred-375.png --size 375x812 --wait 4000 --eval "JSON.stringify({v: window.__predio.vista(), s: window.__predio.escala(), w: document.documentElement.scrollWidth})"`
      imprime `v` = `predio`, `s` entre 0.55 e 0.6 e `w` = 375 (sem rolagem lateral da página)
- [ ] `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1&vista=predio&andar=ti&sala=devs" /tmp/pred-375-zoom.png --size 375x812 --wait 4000 --eval "JSON.stringify({e: window.__predio.enquadramento(), c: window.__predio.medirCrachas()})"`
      imprime `esquerda >= 8`, `direita <= 367`, `sobreMovel: 0`, `cortados: 0`
- [ ] o mesmo com `&andar=produto&sala=produto`, `&andar=cobertura&sala=victor` e `&andar=terreo&sala=recepcao`:
      `sobreMovel: 0`, `cortados: 0`
- [ ] `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1&vista=predio&andar=ti" /tmp/pred-1280-zoom.png --size 1280x800 --wait 4000 --eval "JSON.stringify(window.__predio.medirCrachas())"`
      imprime `sobreMovel: 0`, `cortados: 0`
- [ ] viagens animadas:
      `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1&vista=predio&viagens=demo" /tmp/pred-viagem.png --size 1280x800 --wait 1000 --eval "(async()=>{let max=0;for(let i=0;i<80;i++){max=Math.max(max,window.__predio.elevador().carga.length);await new Promise(r=>setTimeout(r,500));}return JSON.stringify({max, v: window.__predio.viagens()})})()"`
      imprime `max` entre 1 e 3 e `feitas >= 3`
- [ ] aba escondida pula a animação:
      `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1&vista=predio&viagens=demo" /tmp/pred-oculta.png --size 1280x800 --wait 1000 --eval "(async()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setTimeout(r,40000));return JSON.stringify({v: window.__predio.viagens(), c: window.__predio.elevador().carga.length})})()"`
      imprime `resolvidasSemAnimacao >= 3`, `andando: 0` e `c: 0`
- [ ] lembrar a vista: `node scripts/shot.mjs "http://127.0.0.1:5173/?mock=1" /tmp/x.png --size 375x812 --wait 2000 --eval "(async()=>{document.querySelector('.pred-alterna button:nth-child(2)').click();await new Promise(r=>setTimeout(r,300));return localStorage.getItem('escritorio.vista')})()"`
      imprime `eval => predio`
- [ ] dados reais (só leitura): `HERMES_ROOT=$HOME/.hermes HABBLAUD_PORT=4799 npm run dev` e
      `node scripts/shot.mjs "http://127.0.0.1:4799/?vista=predio&debug=1" /tmp/pred-real.png --size 375x812 --wait 6000 --eval "JSON.stringify(window.__predio.medirCrachas())"`
      roda sem `[pageerror]` e mostra o time real (o print vai no PR)
- [ ] a janela do botão de prédio continua igual: `git diff --stat origin/main... -- client/src/ui/predio.ts` vazio

## Fora de escopo / PROIBIDO

- **PROIBIDO** mudar qualquer arquivo em `client/src/world/` (só importar) e trazer `client/src/prototipo/` para a
  `main`; não fazer merge do branch `prototipo/predio-vertical`.
- **PROIBIDO** mudar a vista Salas (o mapa dos projetos), a janela `PredioPanel` e o uso por assinatura.
- **PROIBIDO** tocar em `.env`, `docker-compose*.yml`, `Dockerfile`, deploy, porta ou bind; abrir os kanban.db com
  escrita; ler `messages`, `system_prompt`, `.env`, `auth.json` ou `config.yaml` do Hermes.
- **PROIBIDO** dependência nova no `package.json`; cor de marca, fonte ou logo novas.
- Fora de escopo: usar a escada; som do elevador; tocar num boneco do Prédio para abrir a gaveta; animação de
  chegada/saída de quem entra ou sai do snapshot (aparece e some como no protótipo); viagens entre perfis do mesmo
  andar (seguem como hoje); remover a lista de andares da janela de prédio (pergunta aberta 2); a opção A (prédio
  como tela inicial).

## Plano

Fatias de 1 PR cada, < 1 h. **[T]** = mexe em tela (leva `Design: designer` e a cópia da "ESCOLHA DO VICTOR").
Cabeçalho de cada subtask: `Worker: dev · Reviewer: reviewer · QA: qa` (+ `· Design: designer` nas [T]).
Dependências: S1–S5 podem andar em paralelo; S6 depende de S1; S7 de S6; S8 de S2, S3, S5, S7 (e usa S4 se já
estiver na main); S9 por último.

1. **S1 — Planta vertical com a coluna do elevador** (`client/src/predio/planta.ts`, `planta.test.ts`).
   Copiar `mover`, `plantaVertical`, `terraco` e `montarCena` do protótipo; acrescentar hall, poço, escada, corredores
   abertos para o hall e as paradas (D2). Exportar `montarCena(v: PredioVista, art): Cena` com
   `cena.paradas: Record<AndarId, { cy: number; porta: {tx, ty}; fila: {tx, ty}[] }>` e as constantes de D2.
   Pronto: `npx vitest run client/src/predio/planta.test.ts` passa com testes de: `WT === 41`; 4 paradas na ordem
   Cobertura → Térreo; com `exemploPredio()` (sem e com a sala `extra`) **toda** mesa (`spot.kind === 'desk'`) e todo
   spot da Recepção alcançam o tile da porta do seu andar (`PathFinder.find` verdadeiro); tile da porta e da fila
   caminháveis; poço e escada não caminháveis; nenhuma área passa de `x = 41`.
2. **S2 — Elevador** (`client/src/predio/elevador.ts`, `elevador.test.ts`). D5 inteira.
   Pronto: `npx vitest run client/src/predio/elevador.test.ts` passa com testes de: 1 passageiro Térreo → Cobertura
   chega e gera `embarcou`/`desembarcou`; 5 na fila do mesmo andar → embarcam 3 (ordem de chegada), os 2 restantes na
   próxima parada; desembarque antes do embarque; cabine nunca anda com `porta > 0`; sentido mantido e invertido;
   sem fome (chamadas alternadas em 4 andares por 200 ticks: todas atendidas em ≤ 8 paradas); `resolverTudo` esvazia
   fila e cabine; `de === para` ignorado.
3. **S3 — Viagens e roteiro de demonstração** (`client/src/predio/viagens.ts`, `viagens.test.ts`;
   `criadoPor?: string` em `AgentePredio.hermes` de `client/src/ui/predio-model.ts`). D6 e D11.
   Pronto: `npx vitest run client/src/predio/viagens.test.ts` passa com testes de: 1ª chamada devolve `[]`; dev (TI) →
   produto (3º) gera `entrega` com `quem` = o trabalhador; trabalhador sumido → `quem` = personagem da função; sem
   nenhum → `quem: null`; dev → reviewer (mesmo andar) não gera nada; `running → blocked` gera 1 `portao` (2 no mesmo
   snapshot = 1); sem `default` no snapshot → nenhum `portao`; chave nova com `criadoPor: 'vini'` no produto gera
   `persona`; chave esquecida depois de 15 min não gera entrega; 7 viagens de uma vez → 6 devolvidas e 1 marcada para
   resolver na hora; `roteiroDemo` produz as 3 viagens em 36 s simulados.
4. **S4 — `criadoPor` na fonte do Hermes** (`shared/types.ts`, `server/sources/hermes.ts`,
   `server/sources/hermes.test.ts`). D8.
   Pronto: `npx vitest run server/sources/hermes.test.ts` passa com testes novos: `created_by = 'vini'` → `criadoPor:
   'vini'`; `null`, `''`, `'telegram:123'`, `'a b'`, `'9x'` → sem `criadoPor`; as consultas continuam no banco aberto
   `readOnly`. `grep -n created_by server/sources/hermes.ts` mostra só as 2 consultas e o filtro.
5. **S5 [T] — Sprites da cabine, do poço e da escada** (`client/src/art/furniture/predio.ts`, aditivo em
   `client/src/art/api.ts` e `client/src/art/index.ts`, `client/src/art/art.test.ts`, `client/art-preview.html`).
   `elevatorCab(door: 0..4): Sprite` (3 × 2 tiles, vista de cima, porta no lado oeste, piso e paredes da cabine; o
   mesmo metal da porta `elevator` de `client/src/art/furniture/wall.ts`), `drawShaft(ctx, x, y, w, h)` (vão escuro
   com trilhos), `drawStairs(ctx, x, y, w, h, seed)` (degraus vistos de cima, corrimão). Só cores de `theme.ts`.
   Pronto: `npx vitest run client/src/art/art.test.ts` passa (sprite da cabine com 48 × 32 px opacos nos 5 estados,
   estados diferentes entre si); `art-preview.html` mostra os 3 (print no PR).
6. **S6 [T] — Vista Prédio com dados reais e alternador** (`client/src/predio/{vista,render,bonecos}.ts`,
   `client/src/ui/index.ts`, seção `.pred-*` em `client/src/ui/styles.css`).
   Portar do protótipo a camada, o palco, o desenho (`desenhar`), os bonecos (`criarBonecos`/`passoBoneco`, agora
   **reconciliando por `agentId`** a cada `render()`: entra quem chegou, sai quem sumiu há > 3 s, mesa estável por
   agente), placas dos andares, nomes das salas e crachás simples (acima da cabeça, sem desvio ainda). Desenhar a
   coluna (hall, `drawShaft`, `drawStairs`, cabine parada no Térreo com porta fechada). Alternador e `localStorage`
   (D1), visão geral e + / − (D3, sem tocar-no-andar ainda). Dados: `montarPredio(snapshot.agents, null)`; no
   `?mock=1` sem agentes Hermes, `exemploPredio().agentes` (igual a `predio.ts`).
   Pronto: os comandos de "Definição de pronto" das vistas (`vista()` = `salas` na 1ª vez, `predio` com
   `?vista=predio`, sem rolagem lateral, `localStorage` lembrado) passam; prints `375` e `1280` no PR.
7. **S7 [T] — Tocar no andar, enquadrar sem corte e crachás fora dos móveis** (`client/src/predio/enquadrar.ts` +
   `enquadrar.test.ts`, `client/src/predio/crachas.ts` + `crachas.test.ts`, `vista.ts`, `?andar=`/`&sala=`,
   `window.__predio`).
   Pronto: `npx vitest run client/src/predio/enquadrar.test.ts client/src/predio/crachas.test.ts` passa (sala de
   256 px em W = 375 → escala ≈ 1,40 e retângulo em `[8, 367]`; andar de 624 px em 1280 → ≈ 2,03; crachá sobre mesa
   vai para baixo dos pés; dois crachás vizinhos não se cobrem; crachá na borda é preso dentro do limite); e os 5
   comandos de zoom da "Definição de pronto" imprimem `sobreMovel: 0`, `cortados: 0`. Prints `375-zoom-ti`,
   `375-zoom-produto`, `1280-zoom-ti` no PR.
8. **S8 [T] — Viagens animadas pelo elevador** (`vista.ts`, `bonecos.ts`, `render.ts`; usa S2, S3, S5).
   Ligar `MemoriaCartoes` ao `render()`, a fila, a cabine (desenho na `posicao` fracionária, passageiros recortados
   dentro dela, 📦 sobre a cabine), as 4 sequências e as regras de pular (D7), `?viagens=demo` (D11).
   Pronto: os comandos "viagens animadas" e "aba escondida" da "Definição de pronto" passam; um GIF ou 3 prints em
   sequência (`--frames 3 --interval 800`) de uma viagem no PR.
9. **S9 — Documentação e conferência com dados reais** (`README.md`, `CHANGELOG.md`, `docs/screenshots/predio/`).
   README: na seção "Prédio do time", explicar o botão "Salas | Prédio", o zoom, o elevador (o que faz alguém subir)
   e os parâmetros `?vista=`, `?andar=`, `&sala=`, `?viagens=demo`. Prints novos `predio-375.png`,
   `predio-375-zoom.png`, `predio-1280.png`.
   Pronto: o comando "dados reais" da "Definição de pronto" roda sem `[pageerror]`; README e CHANGELOG no diff;
   `npm run build` passa.
