Quick results for a technical report of the performance of the object `onsetsds~` in contemporary music, specially concentrated on the `OpenScofo` system.

---

## Helmut Lachenmann - Toccatina for solo violin

Gravada por Eric Rynes trecho disponível no [YouTube](https://www.youtube.com/watch?v=vOP8DFK8WMY).

<audio controls src="blog/audios/lachenmann-toccatina.mp3" title="Title"></audio>

**Nota sobre o áudio**:  

* Canal esquerdo: `clicks` identificando onde o algoritmo detecta onsets.  
* Canal direito: a obra.

A obra tem bons resultados, mas, entretanto, após ataques com alta intensidade, o algoritmo perde a capacidade de detectar eventos com menor intensidade (mesmo que sejam com amplitude ok). Isso provavelmente se deve ao parâmetro `relaxtime`, que controla o tempo de relaxamento (ou decaimento) da memória do sistema. O coeficiente de memória determina o quanto o passado ainda influencia os onsets atuais, útil para evitar que picos antigos impactem a detecção de novos onsets.

No algoritmo do `OpenScofo`, sabendo em média a duração de um ataque e quando será o próximo, uma correção possível seria ajustar o coeficiente para metade ou 1/3 da atuação do evento detectado.

Por exemplo, se um evento tem 1 segundo, o `OpenScofo` pode configurar o `relaxtime` para o próximo evento baseado nesse conhecimento.

Além disso, há outros parâmetros a considerar. O `OpenScofo` tem um parâmetro escondido chamado `Kappa`, que indica o quão sincronizada está a detecção de eventos com a previsão da partitura.

---

## Iannis Xenakis - Psappha for solo percussion

Gravada por Ying-Hsueh Chen trecho disponível no [YouTube](https://www.youtube.com/watch?v=1CT5nSkePzg).

<audio controls src="blog/audios/xenakis-psappha.mp3" title="Title"></audio>

**Nota sobre o áudio**:  
Canal esquerdo: `clicks` identificando onde o algoritmo detecta onsets.  
Canal direito: a obra.

**Psappha** é extrema, totalmente percussiva, com momentos de polifonia, que não é o foco atual do OpenScofo. Mesmo assim, o algoritmo ainda consegue ler a maior parte dos eventos musicais. O importante do OpenScofo não é apenas identificar o evento (relativamente fácil), mas saber qual evento está sendo identificado, algo que os algoritmos de onset tradicionais não fazem.

---

### Observações gerais

- Parâmetro `relaxtime`: controla o decaimento da memória do sistema.
- Parâmetro `Kappa`: mede a sincronização entre a detecção de eventos e a previsão da partitura.
- Canal esquerdo dos áudios: `clicks` de detecção de onsets.
- Canal direito dos áudios: gravação da obra original.
