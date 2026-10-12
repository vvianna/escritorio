# Planta do prédio vertical (vista de cima, como o mapa das salas)

Coordenadas em tiles (1 tile = 16 px). Exemplo com `exemploPredio()` (TI com 9 salas, sem "Bancada extra").
Fonte da verdade: as constantes de `client/src/predio/planta.ts` (spec, D2). A coluna da direita é o que o
protótipo não tinha.

```
x:  0 1                               17                              33 35   38 40 41
    |g|<-------- sala 16 -------->|<-------- sala 16 -------->|hall|poço |esc|g|
y 0 ............................ gramado + árvores ...............................
  6 [=========== LAJE  "COBERTURA · NEGÓCIO  ✋ 1 portão" ============]|  |▓▓▓|≡≡|
 10 |  MESA DO VICTOR            |  TERRAÇO (grama, guarda-sol)     |hh|▓▓▓|≡≡|
    |  (layoutProjectRoom)       |                                  |hh|▓▓▓|≡≡|
 22 |=== corredor (vidro a oeste) ================================>>|P |[C]|≡≡|  <- parada 0 (cy = 22)
 27 [=========== LAJE  "3º · PRODUTO  1 trabalhando" ===============]|  |▓▓▓|≡≡|
 31 |  PRODUTO                   |  COPA (layoutCafe)               |hh|▓▓▓|≡≡|
 43 |=== corredor ================================================>>|P |▓▓▓|≡≡|  <- parada 1 (cy = 43)
 48 [=========== LAJE  "2º · TI  7 trabalhando · ✋ 1" ==============]|  |▓▓▓|≡≡|
 52 |  MANAGER                   |  PL OPENS                        |hh|▓▓▓|≡≡|
 64 |=== corredor ================================================>>|P |▓▓▓|≡≡|  <- parada 2 (cy = 64)
 69 |  PL INFRA                  |  BANCADA DEVS                    |hh|▓▓▓|≡≡|
 81 |  PRANCHETA                 |  LAB QA                          |hh|▓▓▓|≡≡|
 93 |=== corredor ================================================>>|hh|▓▓▓|≡≡|  (dá no hall, sem parada)
 98 |  GUARITA SEGURANÇA         |  DOCA DEPLOYER                   |hh|▓▓▓|≡≡|
110 |  SALA PLANTÃO              |  TERRAÇO                         |hh|▓▓▓|≡≡|
122 |=== corredor ================================================>>|hh|▓▓▓|≡≡|  (dá no hall, sem parada)
127 [=========== LAJE  "TÉRREO · PERSONAS  1 conversando" ===========]|  |▓▓▓|≡≡|
131 |  RECEPÇÃO (personas)       |  TERRAÇO                         |hh|▓▓▓|≡≡|
143 |=== corredor ================================================>>|P |▓▓▓|≡≡|  <- parada 3 (cy = 143)
149 ................................ calçada ......................................
151 ================================ rua (carros, caminhão do deployer) ==========
```

Legenda: `hh` hall do andar (piso `concrete`, caminhável) · `P` tile da porta do elevador `(34, cy + 2)` ·
`[C]` cabine (3 × 2 tiles, porta no lado oeste) · `▓▓▓` poço (`drawShaft`, não caminhável) · `≡≡` escada
(`drawStairs`, cenário) · `>>` ponta leste do corredor aberta (tirar `glass_partition` de `ly = 1..3`) · `g` gramado.

## Parada e fila (um andar, zoom)

```
          x=32 (sala)   33    34   35  36  37
cy+0      ── parede ──  hh    hh   ▓   ▓   ▓
cy+1      corredor >>   hh    hh   ┌───────┐
cy+2      corredor >>   F1    P  ← │ cabine│   P = porta (1º da fila); F1, F2… = fila
cy+3      corredor >>   F3    F2   └───────┘
cy+4      ── parede ──  F5    F4   ▓   ▓   ▓
cy+5…                   F7    F6   (a fila desce pelo hall)
```

- Quem chega ocupa o primeiro tile livre na ordem `P, F1, F2, F3…` e anda um passo quando a fila anda.
- A cabine leva no máximo 3. Quem não coube fica no lugar dele na fila.
- O 📦 sozinho (entrega sem `quem`) é desenhado no chão do tile `P` até a cabine chegar.

## Medidas que a spec garante

| tela | visão geral | zoom (tocar no andar) |
| --- | --- | --- |
| 375 px | escala ≈ 0,57; prédio + coluna = 375 px; rola na vertical | 1 sala inteira: escala ≈ 1,40, sala de 8 px a 367 px; o resto do andar se alcança arrastando |
| 1280 px | escala 1,5 (máximo da visão geral); prédio no meio do gramado | andar inteiro (prédio + coluna, 624 px de mundo): escala ≈ 2,03 |
