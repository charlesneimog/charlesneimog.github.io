
                        const dot = `
digraph finite_state_machine {
    layout=circo;
    node [shape=circle, fixedsize=true, width=2, height=2, style=filled, fillcolor=white, color=black, fontsize=16, fontcolor=black, penwidth=2, margin=0.2];
    edge [color=black, arrowsize=2, penwidth=2, fontname="Arial", fontsize=12, fontcolor=black];
    A [label="Play Score"];
    B [label="Analyze Spectrum"];
    C [label="Send to Server"];
    D [label="Extract Main\\nNotes from Spectrum"];
    E [label="Create New Score"];
    F [label="Send to Performers"];
    A -> B;
    B -> C;
    C -> D;
    D -> E;
    E -> F;
    F -> A;
}`;

                        const viz = new Viz();
                        viz.renderSVGElement(dot)
                            .then((element) => {
                                const container = document.getElementById("graph");
                                container.appendChild(element);

                                // Make SVG fill the div
                                element.setAttribute("width", "100%");
                                element.setAttribute("height", "100%");
                            })
                            .catch((error) => console.error(error));
                    