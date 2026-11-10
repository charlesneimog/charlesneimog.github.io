
            import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";

            mermaid.flowchartConfig = {
                width: "100%",
            };
            mermaid.initialize({
                startOnLoad: false,
                flowchart: {
                    useMaxWidth: true,
                },
            });

            window.mermaid = mermaid;
        