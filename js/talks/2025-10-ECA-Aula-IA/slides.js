
                            const dot = `
digraph HMM_Simple {
    rankdir=LR;
    node [shape=circle];

    // Estado S1
    S1 [label="S1"];

    // Próximo estado
    S2 [label="S2"];

    // Transições
    S1 -> S1 [label="0.7 (continuar)"];
    S1 -> S2 [label="0.3 (sair)"];
}
`;

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
                        