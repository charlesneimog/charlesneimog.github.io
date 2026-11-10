#import "@preview/scorify:0.3.0": score

#let inv(top, bottom) = box(
  inset: 0pt,
  baseline: 35%,
)[
  #set text(size: 7pt)
  #stack(
    dir: ttb,
    spacing: 0em,
    align(center)[#top],
    align(center)[#bottom],
  )
]

#set page(
  paper: "a4",
  margin: (
    top: 1.5cm,
    bottom: 1.5cm,
    left: 1.8cm,
    right: 1.8cm,
  ),
)

#set text(
  font: "Libertinus Serif",
  size: 10pt,
)

#set par(justify: true)

#show heading.where(level: 1): set text(size: 13pt)
#show heading.where(level: 2): set text(size: 11pt)

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

#let progression(..chords) = {
  let cells = chords.pos()
  grid(
    columns: (1fr,) * cells.len(),
    align: center,
    ..cells,
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// CABEÇALHO
// ─────────────────────────────────────────────────────────────────────────────

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
    EXERCÍCIOS — AULA 1 E AULA 2
  ]
]

#v(10pt)

#table(
  columns: (1fr, 1fr),
  stroke: 0.6pt,
  inset: 7pt,
  align: left,

  [*Disciplina:* Harmonia II], [*Professor:* Charles K. Neimog],

  [*Nome:*], [*Data:* \_\_/\_\_/\_\_\_\_],
)

#v(10pt)

#set heading(numbering: "1.")


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 2. CONSTRUÇÃO E ANÁLISE DE ACORDES                                       │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Construção e análise de acordes

Construa os acordes indicados. Escreva todas as notas do acorde e respeite
a tonalidade dada.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.7cm,

  [
    == Mi Bemol Maior

    *ii — IV — V — vi — viiº*

    #single-score("treble")
  ],

  [
    == Lá Maior

    *ii — iii — IV — V — viiº*

    #single-score("treble")
  ],

  [
    == Sol menor

    *iiº — iv — V — VI — viiº*

    Utilize a sensível nos acordes que a exigem.

    #single-score("treble")
  ],

  [
    == Dó menor

    *iiº — iv — V — VI — viiº*

    Utilize a sensível nos acordes que a exigem.

    #single-score("bass")
  ],
)

#v(8mm)


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 3. TRÍADE DIMINUTA                                                       │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Tríade diminuta

Realize os encadeamentos em quatro vozes. Observe a tendência da
fundamental do acorde diminuto e a resolução da 5ª diminuta.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.8cm,

  [
    == Dó Maior

    #progression(
      [viiº],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Mi Bemol Maior

    #progression(
      [viiº],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Lá Maior

    #progression(
      [viiº],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Sol menor

    #progression(
      [viiº],
      [→],
      [i],
    )

    #satb-score()
  ],
)

#pagebreak()


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 4. TÉTRADES                                                              │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Tétrades

Construa os acordes indicados. Respeite a inversão determinada pela cifra.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.7cm,

  [
    == Dó Maior

    *V#super[7]*

    #single-score("treble")
  ],

  [
    == Ré Maior

    *V#inv(6, 5)*

    #single-score("treble")
  ],

  [
    == Mi Bemol Maior

    *V#inv(4, 3)*

    #single-score("treble")
  ],

  [
    == Lá Maior

    *V#super[2]*

    #single-score("bass")
  ],

  [
    == Sol menor

    *V#super[7]*

    #single-score("treble")
  ],

  [
    == Dó menor

    *V#inv(6, 5)*

    #single-score("bass")
  ],
)

#v(8mm)


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 5. RESOLUÇÃO DO V7                                                       │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Resolução da dominante com sétima

Realize os encadeamentos em quatro vozes.

A 7ª do acorde deve resolver por grau conjunto descendente. A sensível
deve resolver, preferencialmente, por semitom ascendente. Evite dobrar
a 7ª e priorize a condução mais próxima possível entre as vozes.

#table(
  columns: (1fr, 1fr),
  gutter: 0.4cm,
  row-gutter: 0.9cm,

  [
    == Ré Maior

    #progression(
      [V#super[7]],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Mi Bemol Maior

    #progression(
      [V#super[7]],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Lá Maior

    #progression(
      [V#super[7]],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Si Bemol Maior

    #progression(
      [V#super[7]],
      [→],
      [I],
    )

    #satb-score()
  ],

  [
    == Sol menor

    #progression(
      [V#super[7]],
      [→],
      [i],
    )

    #satb-score()
  ],

  [
    == Dó menor

    #progression(
      [V#super[7]],
      [→],
      [i],
    )

    #satb-score()
  ],
)

#pagebreak()


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 6. CONDUÇÃO DE VOZES                                                     │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Condução de vozes — SATB

Realize integralmente os encadeamentos abaixo em quatro vozes.

Mantenha notas comuns quando conveniente, priorize movimentos conjuntos
ou próximos e evite movimentos desnecessariamente difíceis de cantar.
Observe as resoluções das notas de tendência.

#v(3mm)

== Dó Maior

#progression(
  [I],
  [vi],
  [ii#super[6]],
  [V#super[7]],
  [I],
)

#satb-score()

#v(7mm)

== Sol Maior

#progression(
  [I],
  [IV],
  [ii#super[6]],
  [V#super[7]],
  [I],
)

#satb-score()

#v(7mm)

== Mi Bemol Maior

#progression(
  [I],
  [vi],
  [IV],
  [ii#super[6]],
  [V#super[7]],
  [I],
)

#satb-score()

#v(7mm)

== Lá Maior

#progression(
  [I],
  [iii],
  [vi],
  [ii#super[6]],
  [V#super[7]],
  [I],
)

#satb-score()

#pagebreak()

== Ré menor

#progression(
  [i],
  [VI],
  [iv],
  [V#super[7]],
  [i],
)

#satb-score()

#v(7mm)

== Sol menor

#progression(
  [i],
  [iv],
  [VI],
  [iiº#super[6]],
  [V#super[7]],
  [i],
)

#satb-score()

#v(7mm)


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 7. INVERSÕES E CONDUÇÃO                                                  │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Tétrades em diferentes inversões

Realize os encadeamentos respeitando rigorosamente a inversão indicada.
Observe como a posição do baixo modifica as possibilidades de condução
das demais vozes.

#v(3mm)

== Dó Maior

#progression(
  [I],
  [IV],
  [V#inv(6, 5)],
  [I],
)

#satb-score()

#v(7mm)

== Sol Maior

#progression(
  [I],
  [ii#super[6]],
  [V#inv(4, 3)],
  [I#super[6]],
)

#satb-score()

#v(7mm)

== Ré Maior

#progression(
  [I],
  [IV],
  [V#super[2]],
  [I#super[6]],
)

#satb-score()

#v(7mm)

== Mi Bemol Maior

#progression(
  [I],
  [vi],
  [ii#super[6]],
  [V#inv(6, 5)],
  [I],
)

#satb-score()

#pagebreak()


// ╭──────────────────────────────────────────────────────────────────────────╮
// │ 8. REALIZAÇÃO FINAL                                                      │
// ╰──────────────────────────────────────────────────────────────────────────╯

= Realização

Realize integralmente as progressões abaixo em SATB. Não há notas
fornecidas: escolha a disposição inicial e conduza cada voz até o final
da progressão.

Considere simultaneamente:

- tessitura e cantabilidade das quatro vozes;
- movimentos próximos;
- notas comuns entre acordes;
- resolução da sensível;
- resolução descendente da 7ª;
- tratamento da tríade diminuta;
- inversões indicadas;
- possibilidade de omissão da 5ª nas tétrades quando isso favorecer
  a condução.

#v(4mm)

== Si Bemol Maior

#progression(
  [I],
  [iii],
  [vi],
  [ii#super[6]],
  [V#super[7]],
  [I],
)

#satb-score()

#v(10mm)

== Mi Maior

#progression(
  [I],
  [vi],
  [IV],
  [ii#super[6]],
  [V#inv(6, 5)],
  [I],
)

#satb-score()

#v(10mm)

== Dó menor

#progression(
  [i],
  [VI],
  [iv],
  [iiº#super[6]],
  [V#super[7]],
  [i],
)

#satb-score()

