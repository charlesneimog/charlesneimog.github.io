
            Reveal.initialize({
                margin: 0.01,
                width: 1600,
                height: 900,
                slideNumber: true,
                showSlideNumber: "all",
                plugins: [RevealHighlight, RevealMenu, RevealMath.MathJax3],
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
        