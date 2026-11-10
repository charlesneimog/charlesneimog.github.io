
            window.onload = async function () {
                const slides = document.getElementById("slides");
                if (slides === null) {
                    alert("Missing slides elements on index.html");
                    return;
                }
                window.mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "loose",
                    themeVariables: {
                        fontFamily: "Arial, Helvetica, sans-serif",
                    },
                    flowchart: {
                        useMaxWidth: true,
                        htmlLabels: false,
                    },
                });

                const p = new Markdown2Slide(window.__SLIDES_MARKDOWN__);
                p.render();
                await Reveal.initialize({
                    center: false,
                    margin: 0.01,
                    width: 1600,
                    height: 900,
                    slideNumber: true,
                    showSlideNumber: "all",
                    plugins: [MathJax],
                    menu: {
                        side: "left",
                        width: "normal",
                        theme: "simple",
                        numbers: false,
                        titleSelector: "h1, h2",
                        useTextContentForMissingTitles: false,
                        hideMissingTitles: true,
                        markers: true,
                        openButton: true,
                        openSlideNumber: true,
                        keyboard: true,
                    },
                });
                const enhanceCurrentSlide = createSlideEnhancer(Reveal);
                Reveal.on("ready", enhanceCurrentSlide);
                Reveal.on("slidechanged", enhanceCurrentSlide);
                Reveal.on("slidetransitionend", enhanceCurrentSlide);
                Reveal.on("fragmentshown", enhanceCurrentSlide);
                Reveal.on("fragmenthidden", enhanceCurrentSlide);
                Reveal.on("resize", fitMermaidToSlides);

                enhanceCurrentSlide();

                window.addEventListener("resize", fitMermaidToSlides);
            };
