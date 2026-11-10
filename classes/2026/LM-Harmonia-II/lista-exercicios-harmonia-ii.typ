#import "@preview/scorify:0.3.0": score

#let inv(top, bottom) = box(
  inset: 0pt,
  baseline: 35%,
)[
  #set text(size: 7pt)

  #stack(
    dir: ttb,
    spacing: 0.0em,
    align(center)[#top],
    align(center)[#bottom],
  )
]

#set page(
  paper: "a4",
  margin: (
    top: 1.5cm,
    bottom: 1.5cm,
    left: 2cm,
    right: 2cm,
  ),
)

#set text(
  font: "Libertinus Serif",
)

#show heading.where(level: 1): set text(
  size: 12pt,
)

#show heading.where(level: 2): set text(
  size: 12pt,
)

#set par(justify: true)

#let single-score(clef) = score(
  key: "C",
  staves: (
    (
      clef: clef,
      brace-start: true,
    ),
  ),
  staff-size: 5pt,
)

#let satb-score() = score(
  key: "C",
  staves: (
    (
      clef: "treble",
      brace-start: true,
    ),
    (
      clef: "bass",
      brace-end: true,
    ),
  ),
  staff-size: 5pt,
  staff-spacing: 5mm,
)

// Mantém cada exercício inteiro na mesma página.
#let exercise(body) = block(
  breakable: false,
  body,
)

#align(center)[
  #text(size: 14pt, weight: "bold")[
    UNIVERSIDADE ESTADUAL DO PARANÁ — UNESPAR
  ]

  #v(2pt)

  #text(size: 11pt)[
    Curso de Licenciatura em Música
  ]

  #v(8pt)

  #text(size: 16pt, weight: "bold")[
    EXERCICÍOS - AULA 3 E 4
  ]
]

#v(10pt)

#table(
  columns: (1fr, 1fr),
  stroke: 0.6pt,
  inset: 7pt,
  align: left,

  [*Disciplina:* Harmonia II], [*Professor:* Charles K. Neimog],
  [*Data:* \_\_/\_\_/\_\_\_\_], [*Nome:*],
  [*Turma:*], [*Entrega:*],
)

#v(12pt)

#set heading(numbering: "1.")

//╭─────────────────────────────────────╮
//│       DOMINANTES SECUNDÁRIAS        │
//╰─────────────────────────────────────╯
= Dominantes secundárias

Escreva cada progressão em quatro vozes (SATB). A dominante secundária deve ser cifrada como *V/x*, em que *x* é o grau tonicizado. Não use o vii como grau-alvo.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.9cm,

  [#exercise[
    == Dó Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/V], [V],
    )

    #satb-score()
  ]],

  [#exercise[
    == Sol Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/ii], [ii],
    )

    #satb-score()
  ]],

  [#exercise[
    == Fá Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/iii], [iii],
    )

    #satb-score()
  ]],

  [#exercise[
    == Si Bemol Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/IV], [IV],
    )

    #satb-score()
  ]],

  [#exercise[
    == Ré Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/vi], [vi],
    )

    #satb-score()
  ]],

  [#exercise[
    == Lá menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/iv], [iv],
    )

    #satb-score()
  ]],

  [#exercise[
    == Mi menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/V], [V],
    )

    #satb-score()
  ]],

  [#exercise[
    == Ré menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/III], [III],
    )

    #satb-score()
  ]],

  [#exercise[
    == Sol menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/VI], [VI],
    )

    #satb-score()
  ]],

  [#exercise[
    == Dó menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [V/iv], [iv],
    )

    #satb-score()
  ]],
)

#pagebreak()

//╭─────────────────────────────────────╮
//│              ii–V–I                 │
//╰─────────────────────────────────────╯
= ii → V → I: segundos cadenciais

Escreva cada progressão em quatro vozes (SATB). Para um grau-alvo maior, use *ii/x → V/x → x*. Para um grau-alvo menor, use *iiº/x → V/x → x* — isto é, a lógica *iiº → V → i* aplicada à tonalidade tonicizada.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.9cm,

  [#exercise[
    == Dó Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii/V], [V/V], [V],
    )

    #satb-score()
  ]],

  [#exercise[
    == Sol Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii/IV], [V/IV], [IV],
    )

    #satb-score()
  ]],

  [#exercise[
    == Ré Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii#super[º]/vi], [V/vi], [vi],
    )

    #satb-score()
  ]],

  [#exercise[
    == Fá Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii#super[º]/ii], [V/ii], [ii],
    )

    #satb-score()
  ]],

  [#exercise[
    == Si Bemol Maior

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii#super[º]/iii], [V/iii], [iii],
    )

    #satb-score()
  ]],

  [#exercise[
    == Lá menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii/III], [V/III], [III],
    )

    #satb-score()
  ]],

  [#exercise[
    == Mi menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii#super[º]/iv], [V/iv], [iv],
    )

    #satb-score()
  ]],

  [#exercise[
    == Ré menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii/V], [V/V], [V],
    )

    #satb-score()
  ]],

  [#exercise[
    == Sol menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii/VI], [V/VI], [VI],
    )

    #satb-score()
  ]],

  [#exercise[
    == Dó menor

    #grid(
      columns: (0.5fr, 0.5fr, 0.5fr, 0.5fr),
      align: center,
      [], [ii#super[º]/iv], [V/iv], [iv],
    )

    #satb-score()
  ]],
)

