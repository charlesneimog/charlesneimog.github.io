# Roteiro de apresentação — pd4web e VSAT/AUDIENCE

**Duração estimada:** 5 minutos

---

### SLIDE 1 — pd4web na integração com VSAT/AUDIENCE
**Tempo: 0:00–0:20**

Bom dia, pessoal. Meu nome é Charles Neimog e vou falar um pouco sobre como funciona a integração entre o A-Frame, responsável pela parte gráfica, e o AUDIENCE, responsável pelo processamento de áudio espacial.

Para isso, utilizamos o **pd4web**, um framework que desenvolvi durante meu doutorado.

**→ PRÓXIMO SLIDE**

### SLIDE 2 — Contexto do projeto
**Tempo: 0:20–0:55**

Primeiro, contextualizando o projeto: o VSAT é uma plataforma web para criação de narrativas imersivas em 360 graus.

Já o AUDIENCE é um motor de áudio espacial desenvolvido em Pure Data, a partir de uma pesquisa conduzida pelo professor Régis e seus colaboradores há mais de 20 anos.

O desafio era justamente reutilizar esse processamento em uma aplicação web, integrando as imagens em 360 graus ao áudio espacial interativo, sem precisar reescrever os algoritmos do AUDIENCE.

**→ PRÓXIMO SLIDE**

### SLIDE 3 — O que é o pd4web?
**Tempo: 0:55–1:35**

Mas o que é o pd4web?

Basicamente, é um framework de código aberto que permite executar patches de Pure Data, uma linguagem de programação visual, diretamente no navegador.

Para isso, compilamos o motor do Pure Data e suas bibliotecas externas para WebAssembly.

Destaco as bibliotecas externas porque o AUDIENCE depende de objetos próprios, desenvolvidos especificamente para o processamento de áudio espacial.

Além disso, utilizamos o AudioWorklet, que permite executar o processamento sonoro em um contexto separado da interface gráfica.

O pd4web também oferece mecanismos de comunicação entre JavaScript e Pure Data.

**→ PRÓXIMO SLIDE**

### SLIDE 4 — Arquitetura da integração
**Tempo: 1:35–2:05**

Aqui podemos observar a arquitetura geral.

Na parte superior, temos o VSAT, que utiliza o A-Frame para representar o ambiente visual.

O A-Frame se comunica com o pd4web, que faz a ponte com o AUDIENCE, executado dentro do ambiente do Pure Data.

Dessa forma, conseguimos enviar informações sobre a orientação do observador, realizar a rotação da cena sonora e depois decodificar o áudio para reprodução estéreo.

As setas bidirecionais representam a possibilidade de comunicação nos dois sentidos entre os componentes.

**→ PRÓXIMO SLIDE**

### SLIDE 5 — Compilação e registro dos externos
**Tempo: 2:05–2:40**

Mas como fazemos essa integração?

O pd4web automatiza diversas etapas. Primeiro, identifica e obtém as dependências necessárias, incluindo os repositórios das bibliotecas externas.

Depois, analisa o código-fonte para identificar as funções responsáveis por registrar esses objetos no Pure Data.

Com isso, gera automaticamente um arquivo C++ com as funções de inicialização.

Aqui temos dois exemplos de objetos do AUDIENCE que são registrados automaticamente.

O ponto importante é que **não precisamos reimplementar esses algoritmos em JavaScript**.

**→ PRÓXIMO SLIDE**

### SLIDE 6 — Inicialização do AUDIENCE no navegador
**Tempo: 2:40–3:00**

Depois de compilar os objetos, precisamos inicializá-los.

Nesse trecho podemos observar a chamada de `Pd4WebInitExternals`, que registra os objetos externos, antes da abertura do patch com `libpd`.

Assim, o patch do AUDIENCE pode utilizar seus objetos normalmente, mas agora dentro do navegador.

**→ PRÓXIMO SLIDE**

### SLIDE 7 — Browser, AudioWorklet e threads
**Tempo: 3:00–3:30**

Aqui temos uma característica importante da arquitetura.

O A-Frame e a interface gráfica são executados na thread principal do navegador, enquanto o pd4web e o AUDIENCE executam o processamento sonoro no AudioWorklet.

Essa separação é importante porque a renderização gráfica não deve interromper o processamento de áudio.

Por outro lado, cria um desafio: precisamos estabelecer mecanismos para enviar mensagens entre esses ambientes e garantir que elas sejam processadas corretamente.

**→ PRÓXIMO SLIDE**

### SLIDE 8 — Comunicação entre A-Frame e Pure Data
**Tempo: 3:30–3:55**

Aqui temos um exemplo concreto dessa comunicação.

O A-Frame permite obter a orientação da câmera por meio de um vetor tridimensional.

Esse vetor é enviado ao pd4web usando `sendList`, com o identificador `ori_rcv`, que corresponde ao receptor no patch de Pure Data.

Assim, quando o usuário muda sua orientação, o AUDIENCE recebe os novos parâmetros e pode atualizar a rotação da cena sonora.

**→ PRÓXIMO SLIDE**

### SLIDE 9 — Comunicação entre A-Frame e Pure Data
**Tempo: 3:55–4:05**

Portanto, o fluxo é este: o A-Frame obtém a orientação, via JavaScript envia os valores ao pd4web e o AUDIENCE utiliza esses dados para atualizar o processamento espacial.

**→ PRÓXIMO SLIDE**

### SLIDE 10 — Sincronização de mensagens
**Tempo: 4:05–4:30**

Mas existe um detalhe importante.

Como estamos trabalhando com threads diferentes, não podemos tratar essa comunicação simplesmente como uma chamada direta ao Pure Data.

O pd4web recebe os valores do JavaScript, converte essas informações em mensagens compatíveis com o Pure Data e as armazena em uma fila protegida por um mutex.

Isso permite organizar as mensagens que serão processadas no contexto de áudio.

**→ PRÓXIMO SLIDE**

### SLIDE 11 — Sincronização de mensagens
**Tempo: 4:30–4:50**

No callback de processamento do AudioWorklet, o pd4web consulta essa fila e encaminha as mensagens para o Pure Data utilizando as funções do `libpd`.

Também existe um mecanismo correspondente para enviar mensagens do Pure Data de volta ao navegador.

Dessa forma, conseguimos manter a comunicação entre a interface visual e o processamento sonoro.

**→ PRÓXIMO SLIDE**

### SLIDE 12 — Possibilidades e conclusão
**Tempo: 4:50–5:10**

Para concluir, o principal resultado dessa integração é que conseguimos reutilizar o processamento desenvolvido no AUDIENCE diretamente em uma aplicação web imersiva.

Isso permite combinar ferramentas de áudio espacial, desenvolvidas ao longo de muitos anos, com tecnologias contemporâneas de realidade virtual na web.

E, principalmente, disponibilizar essas experiências sem exigir a instalação de software especializado.

Obrigado.
