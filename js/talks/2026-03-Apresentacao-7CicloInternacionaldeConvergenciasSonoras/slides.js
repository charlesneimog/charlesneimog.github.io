
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
                    loadIcons: false,
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

            function setup() {}
            let fft_p5;
            let improviso_p5;

            // ───────────────────────────────────────
            Reveal.addEventListener("slidechanged", function (event) {
                if (event.currentSlide.id === "slide1") {
                } else if (event.currentSlide.id === "slide-improviso") {
                    improviso_p5 = new p5(sketch_improviso);
                    improviso_p5.loop();
                } else if (event.currentSlide.id === "slide-fft") {
                    function slider8Animation() {
                        setTimeout(() => {
                            fft_p5 = new p5(sketch_fft);
                        }, 20);
                    }
                    chunk = loadSound(
                        "../2025-03-Defesa/440.mp3",
                        slider8Animation,
                        null,
                    );
                }
                // ───────────────────────────────────────
                if (
                    event.currentSlide.id !== "slide-improviso" &&
                    improviso_p5
                ) {
                    improviso_p5.remove();
                    improviso_p5 = null;
                }

                // ───────────────────────────────────────
                if (event.currentSlide.id !== "slide-fft" && fft_p5) {
                    fft_p5.remove();
                    fft_p5 = null;
                }
            });
        