# Towards an Integrated Environment for Telematic Music {font-size="80px"}

Charles K. Neimog

NowNet Arts Conference Forum 2026

## Fragmentation of the Technical Environment {font-size="50px"}

```mermaid
flowchart LR
    J[JackTrip] --> R1[Audio Router]
    R1 --> M[Max/MSP]
    M --> R2[Audio Router]
    R2 --> O[OBS]
    Z[Zoom] --> O
    O -->|Virtual Camera| T[TouchDesigner]
    T -->|Window Capture| O
    O --> W[Twitch]
```

<div style="font-size: 25px">

- Multiple software environments.
- Complex audio and video routing.
- Fragmentation of technical knowledge.
</div>

## Fragmentation of Artistic Practice

```mermaid
flowchart LR
    A[Artist A] --> M[Max/MSP]
    B[Artist B] --> T[TouchDesigner]
    C[Artist C] --> O[OBS]
    M --> P[Performance]
    T --> P
    O --> P
```

<div style="font-size: 32px; margin-top: 30px">

- Technical specialization can become a division of artistic labor.
- Clear boundaries emerge around who controls what.
- This can limit interventions in each other’s work.
</div>

## A Shared Technical Environment

```mermaid
flowchart LR
    A[Artist A] --> M
    B[Artist B] --> M
    C[Artist C] --> M
    subgraph M[Max/MSP]
        direction TB
        S[Sound Processing] <--> V[Visual Processing]
        S <--> N[Network Communication]
        V <--> N
    end
```
## A Shared Technical Environment

- Shared technical knowledge.
- Integration of audiovisual processes.
- Greater permeability between individual contributions.
- Better conditions for collective experimentation.


## Towards a More Organic Environment

In pursuing this idea, I have been exploring whether it is possible to create a more organic technical environment that allows this collective practice to emerge.

## p2p — Recent Experiments

```mermaid
flowchart TD
    S[Cloudflare Workers]
    S -.-|Signaling| A[Max/MSP]
    S -.-|Signaling| B[Pure Data]
    S -.-|Signaling| C[Browser]
    A <-->|WebRTC| B
    B <-->|WebRTC| C
    C <-->|WebRTC| A
```

<div style="font-size: 20px; margin-top: 20px">

- Recent experiments with p2p using libdatachannel.
- Signaling infrastructure implemented with Cloudflare Workers.
- Audio, video, and messages can circulate within a more unified environment.
- The goal is not only efficiency, but a more shared artistic space.
</div>

## Beyond Technical Integration

<div style="font-size: 28px">

- Technology as a shared artistic material.
- A more collective relation to the digital environment.
- New possibilities for intervention across artistic roles.
- Search for a more collective creative process in the Telematic.
</div>

## Thanks

* https://github.com/charlesneimog/p2p

<img style="width: 30%" src="https://github.com/charlesneimog/p2p/blob/main/resources/max.jpeg?raw=true"/>
<img style="width: 30%" src="https://github.com/charlesneimog/p2p/blob/main/resources/pd.png?raw=true"/>

