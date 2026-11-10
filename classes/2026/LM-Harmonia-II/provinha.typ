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

#set text(font: "Libertinus Serif")
#set par(justify: true)

#show heading.where(level: 1): set text(size: 12pt)
#show heading.where(level: 2): set text(size: 11pt)

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
  staff-spacing: 6mm,
)

#align(center)[
  #text(size: 16pt, weight: "bold")[
    HARMONIA II -- LM 2
  ]
]

#v(5pt)

Nome: #line(length: 75%)

#v(12pt)

= Realize os encadeamentos em 4 vozes.

Evite 5ª e 8ª paralelas, priorize movimentos próximos e resolva
corretamente as notas de tendência. Nos acordes com sétima,
a 7ª deve resolver por grau conjunto descendente.

// 1) SOL MAIOR — TRÍADES
//
// I – iii6 – vi – IV – ii6 – V – I
//
// BAIXO:
// G – D – E – C – C – D – G

== 1) Sol Maior

#grid(
  columns: (0.3fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
  align: center,
  [], [I], [iii#super[6]], [vi], [IV], [ii#super[6]], [V], [I],
)

#satb-score()


// 2) LÁ BEMOL MAIOR — TÉTRADES
//
// I – vi7 – IV – ii6/5 – V4/3 – I
//
// BAIXO:
// Ab – F – Db – Db – Bb – Ab
//
// ii6/5 = Bb-Db-F-Ab
// baixo: Db
//
// V4/3 = Eb-G-Bb-Db
// baixo: Bb

== 2) Lá Bemol Maior

#grid(
  columns: (0.3fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
  align: center,
  [], [I], [vi#super[7]], [IV], [ii#inv(6, 5)], [V#inv(4, 3)], [I],
)

#satb-score()


// 3) LÁ MENOR — DOMINANTE SECUNDÁRIA
//
// i – VI – V7/iv – iv – iiø6/5 – V7 – i
//
// V7/iv = C7
// C-E-G-Bb → F-A-C
//
// BAIXO:
// A – F – C – F – D – E – A
//
// V7/iv:
// E → F  = sensível do acorde-alvo
// Bb → A = 7ª descendente
//
// iiø6/5 = B-D-F-A
// baixo: D
//
// V7 = E-G#-B-D
// G# → A
// D → C

== 3) Lá menor

#grid(
  columns: (0.3fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
  align: center,
  [], [i], [VI], [V#super[7]/iv], [iv], [ii#super[ø]#inv(6, 5)], [V#super[7]], [i],
)

#satb-score()


// 4) LÁ MAIOR — DOMINANTE SECUNDÁRIA
//
// I – vi – V7/ii – ii – ii6/5 – V7 – I
//
// BAIXO:
// A – F# – F# – B – D – E – A
//
// V7/ii = F#7
// F#-A#-C#-E → B-D-F#
//
// A# → B = sensível do acorde-alvo
// E → D  = 7ª descendente
//
// ii6/5 = B-D-F#-A
// baixo: D
//
// V7 = E-G#-B-D
// G# → A
// D → C#

== 4) Lá Maior

#grid(
  columns: (0.3fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
  align: center,
  [], [I], [vi], [V#super[7]/ii], [ii], [ii#inv(6, 5)], [V#super[7]], [I],
)

#satb-score()
