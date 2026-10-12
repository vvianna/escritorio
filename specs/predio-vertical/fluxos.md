# Fluxos e arquitetura do prédio vertical

## Módulos (o que é novo e o que só é importado)

```mermaid
flowchart LR
  subgraph servidor["servidor (só leitura)"]
    H["server/sources/hermes.ts<br/>+ criadoPor (S4)"]
  end
  subgraph ui["client/src/ui (existente)"]
    IDX["index.ts<br/>(liga VistaPredio)"]
    PM["predio-model.ts<br/>montarPredio · PLANTA · salaDe"]
    PP["predio.ts<br/>janela de uso (NÃO muda)"]
  end
  subgraph novo["client/src/predio (novo)"]
    V["vista.ts<br/>alternador · zoom · toque · loop · __predio"]
    PL["planta.ts (S1)"]
    EL["elevador.ts (S2)"]
    VI["viagens.ts (S3)"]
    EN["enquadrar.ts (S7)"]
    CR["crachas.ts (S7)"]
    BO["bonecos.ts (S6/S8)"]
    RE["render.ts (S6/S8)"]
  end
  subgraph world["client/src/world + art (só importados; art ganha 3 sprites em S5)"]
    LY["layout/*"]
    SC["render/scene.ts · props.ts"]
    PA["path/astar · grid"]
    ART["art (+ elevatorCab · drawShaft · drawStairs)"]
  end
  H -->|snapshot WebSocket| IDX --> V
  V --> PM
  V --> PL --> LY
  V --> VI --> PM
  V --> EL
  V --> BO --> PA
  V --> RE --> SC
  RE --> ART
  V --> EN
  V --> CR
```

## Uma viagem de entrega (o cartão passa do dev da TI para o Produto)

```mermaid
sequenceDiagram
  autonumber
  participant S as snapshot (store)
  participant M as MemoriaCartoes
  participant B as boneco do dev (TI)
  participant E as ElevadorPredio
  participant Q as boneco do produto (3º)
  S->>M: escritorio/t_x agora com "produto" (antes "dev", TI)
  M-->>B: Viagem entrega (de TI, para produto, quem = dev, destino = produto)
  Note over B: pula a animação se aba escondida, vista Salas,<br/>trajeto fora da tela ou 6 pendentes
  B->>B: pega o 📦 e anda até a porta do TI (ou o fim da fila)
  B->>E: chamar(dev, TI, 3º)
  E-->>B: porta abre · embarcou
  E->>E: cabine sobe pelo poço (900 ms por andar)
  E-->>B: porta abre no 3º · desembarcou
  B->>Q: anda até a frente da mesa e entrega o 📦 (1,5 s)
  Q->>Q: segura o 📦 2 s e volta ao estado dele
  B->>E: chamar(dev, 3º, TI)
  E-->>B: desembarcou no TI
  B->>B: anda até a mesa e retoma o estado (ou some, se já saiu do snapshot)
```

Variações: **portão** (o Manager sobe com papéis até a Mesa do Victor, 4 s, volta), **persona** (sai da Recepção
com o 📦, entrega, volta), **📦 sozinho** (`quem = null`: a caixa viaja na cabine e quem recebe busca na porta).

## O que dispara cada viagem

```mermaid
flowchart TD
  A[novo snapshot] --> B{1ª carga?}
  B -- sim --> Z[só guarda a memória, nada anda]
  B -- não --> C{chave já vista?}
  C -- sim --> D{mudou de perfil?}
  D -- sim --> E{andar diferente?}
  E -- sim --> EN[entrega]
  E -- não --> N1[nada: segue como hoje]
  D -- não --> F{passou a blocked?}
  C -- não --> G{criadoPor é persona<br/>e o dono fica fora do Térreo?}
  G -- sim --> PE[persona]
  G -- não --> F
  F -- sim --> H{há Manager e nenhuma<br/>viagem de portão já em curso?}
  H -- sim --> PO[portão]
  H -- não --> N2[nada]
  F -- não --> N2
  EN & PE & PO --> L{"aba escondida, vista Salas,<br/>trajeto fora da tela ou ≥ 6 pendentes?"}
  L -- sim --> R[resolve na hora: todos no lugar final]
  L -- não --> AN[anima]
```

## Cabine (máquina de estados de `elevador.ts`)

```mermaid
stateDiagram-v2
  [*] --> Parada
  Parada --> Abrindo: alguém desce aqui ou espera aqui
  Parada --> Movendo: chamada noutro andar
  Abrindo --> Aberta: 450 ms
  Aberta --> Aberta: desce quem tem este destino (300 ms cada),<br/>depois embarca a fila até 3
  Aberta --> Fechando: 650 ms sem movimento
  Fechando --> Abrindo: chegou alguém na porta antes de fechar
  Fechando --> Parada: 450 ms, sem ninguém pedindo
  Fechando --> Movendo: 450 ms, há próxima parada
  Movendo --> Abrindo: chegou à próxima parada (mesmo sentido; sem nenhuma, inverte)
```
