# pd4web: Programação Criativa na Web

<h3>Introdução</h3>

Charles K. Neimog{margin-top="300px"}

Universidade de São Paulo

## Conteúdo | Módulo 1 | (10/04)

* _Introdução, Documentação e Artigos;_
* _Front-end, Instalação; Configuração, Compilação e Upload;_
    * Pure Data e Python;
    * _Em caso de problemas resolvemos durante essa semana de iato_;
* _Compilador e **como** funciona_;
    * Processador do patch;
    * Gerenciador de bibliotecas;
    * Download de código fonte e Compilação;
* _Pd4Web e WebAudio_;
    * Processamento de áudio;
    * WebAudio;
* _Exemplos_ Projetos;

## Conteúdo | Módulo 2 | (24/04)

* Integrações;
    * _p5js_ (gráficos 2d);
    * _ml5_ (detecção de mãos);
    * _vexflox_ (partitura);
    * _threejs_ (gráficos 3d);
* Projetos;

## **Introdução** | Artigo | Documentação

<div style="
  width: 80%;
  display: flex;
  gap: 10px;
  margin: 0 auto;
  justify-content: center;
">
  <div style="width: 50%; text-align: center;">
    <img src="../../images/music/eco1.avif" style="width: 100%;">
    <p>Eco 1 (2022)</p>
  </div>

  <div style="width: 50%; text-align: center;">
    <img src="moteto.avif" style="width: 100%;">
    <p>Moteto (2022)</p>
  </div>
</div>

## Introdução | **Artigo** | Documentação

[Artigo](https://www.researchgate.net/publication/395664963_Enabling_Interactive_Music_Performance_through_Web_Browsers_for_non-Programmers){align="center"; target="_blank"}

![artigo](artigo.avif){width="50%"}

## Introdução | Artigo | **Documentação**

[https://charlesneimog.github.io/pd4web](https://charlesneimog.github.io/pd4web){align="center"; target="_blank"}

![artigo](docs.avif){width="50%"}

## Instalação (Pd)

* Python: `pip install pd4web`
* PureData: Tools->Find Externals, procure por `pd4web`, instale!

## Instalação (Pd)

* Em alguns casos, pode ser necessário instalar Python manualmente.
    * MacOS: [https://www.python.org/downloads/](https://www.python.org/downloads/);
    * Linux;
        * `apt install python3`;
        * `pacman install python3`;
        * `dnf install python3`;
    * Windows: O `pd4web` vai instalar automaticamente;

## Instalação e Compilação (Pd)

![Patch de Compilação](../../images/articles/pd4web0.avif)

## Instalação e Compilação (Python)

* `pip install pd4web`;
* `pip install --upgrade pd4web`;
* `pd4web hello-world.pd`;

## Configuração e Demonstração

[https://charlesneimog.github.io/pd4web/patch/compile/](https://charlesneimog.github.io/pd4web/patch/compile/)

## Desenvolvimento de patches

* Sobre Arquivos de Áudio;
* Sobre SubPatches;

## Upload

* Tudo é empacotado dentro da pasta `WebPatch`;

## Errors Comuns

* Memória, arquivos não encontrados;

## **Como** funciona

```mermaid
%%{init: {
  "themeVariables": {
    "fontSize": "18px",
    "fontFamily": "arial"
  }
}}%%
flowchart LR

    A["`**Pd4Web**`"]

    subgraph CORE["Core Pipeline"]
        direction TB
        Ba["Front-End"]
        Bb["Compilador"]
        Bc["Patch Compilado"]
    end
    %% Light Blue styling for Core
    style CORE fill:#e3f2fd,stroke:#1565c0,stroke-width:2px

    subgraph DEPS["Interfaces"]
        Ca["Python<br/>Pure Data"]
    end
    %% Light Orange styling for Deps
    style DEPS fill:#fff3e0,stroke:#e65100,stroke-width:2px

    subgraph COMPILER["Processo do Compilador"]
        direction TB
        De["Análise do Patch"]
        Da["Git (Bibliotecas Externas)"]
        Dc["Tree-Sitter (Analisa código)"]
        Dd["CMake (Filtra o build)"]
        Db["Emscripten (Compila C/C++ para WASM)"]
    end
    %% Light Green styling for Compiler
    style COMPILER fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    subgraph OUTPUT["Web Environment"]
        Ec["LibPd<br/>(Audio Worklet / WASM)"]
    end
    %% Light Purple styling for Output
    style OUTPUT fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    subgraph GUI["Interface Gráfica"]
        direction TB
        Fa["NanoVG"]
        Fb["WebGL ou WebGPU"]
    end
    %% Light Yellow styling for GUI
    style GUI fill:#fffde7,stroke:#f57f17,stroke-width:2px

    subgraph Audio["Web Audio"]
        direction TB
        Ga["Input (Microfones)"]
        Gb["Output (Alto-Falantes)"]
    end
    %% Light Red/Pink styling for Audio
    style Audio fill:#ffebee,stroke:#c62828,stroke-width:2px


    %% Main flow
    A --> Ba
    A --> Bb
    A --> Bc

    %% Dependencies
    Ba --> Ca

    %% Compiler breakdown
    Bb --> Da
    Bb --> Dc
    Bb --> Dd
    Bb --> Db
    Bb --> De

    %% Output connection (Connecting the compilation to the result)
    Db -.-> Bc

    %% Graphic stack
    Fa --> Fb

    %% Outputs & Execution
    Bc --> Ec

    %% Input | Output Data flow
    Ga -->|In| Ec
    Ec -->|Out| Gb
    Ec -->|GUI| Fa
```

## Como funciona (Compilação)

* A parte maior do projeto é o compilador;
    * Análise do Patch (`Sources/Compiler/patch.cpp`);
    * Git (Bibliotecas Externas) (`Sources/Compiler/git.cpp`);
    * Tree-Sitter (Analisa código) (`Sources/Compiler/libraries.cpp`);
    * CMake (Filtra o build) (`Sources/Compiler/builder.cpp`);
    * Emscripten (Compila C/C++ para WASM) (`Sources/Compiler/utils.cpp`);


## Como funciona (WebAudio)

* Parte de Audio (`Sources/Pd4Web/pd4web.cpp`);
* Parte Gráfica (`Sources/Pd4Web/pd4weblua_gfx.c` e `Sources/Pd4Web/pd4web.cpp`);

```mermaid
%%{init: {
  "themeVariables": {
    "fontSize": "18px",
    "fontFamily": "arial"
  }
}}%%
flowchart LR
    A[WebAudio]
    Aa[WebMIDI]
    B[WebGL]
    C[pdlua]
    D[NanoVG]

    E[libpd]

    E-->A
    E-->Aa
    E-->C
    C-->D
    D-->B
```

## Perguntas ou Questões?

## Exemplos e Projetos

* [Moteto I](https://charlesneimog.github.io/Pandemonio/WebPatch/index.html);
* [Cânticos de Silício I](https://charlesneimog.github.io/Canticos-de-Silicio-I/);
* [Local Maxima](https://charlesneimog.github.io/Tese/Pages/Local-Maxima/WebPatch/index.html);
* [Improviso](https://charlesneimog.github.io/Improviso-I/);
* [Algorithm I](https://charlesneimog.github.io/Algorithm-Music/Piece-I/webpatch/index.html);
* [BiA](https://nucleomusicanova.github.io/BiA/);


## Módulo 2 - pd4web + libraries
