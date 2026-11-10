
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      Reveal.initialize({
        transition: "zoom",
        width: 1600,
        height: 900,
        slideNumber: true,
        history: false,
        showSlideNumber: "all",
        plugins: [MathJax],
        math: {
          mathjax:
            "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/latest.min.js",
          config: "TeX-AMS_HTML-full",
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
          chunk = loadSound("./440.mp3", slider8Animation, null);
        }
        // ───────────────────────────────────────
        if (event.currentSlide.id !== "slide-improviso" && improviso_p5) {
          improviso_p5.remove();
          improviso_p5 = null;
        }

        // ───────────────────────────────────────
        if (event.currentSlide.id !== "slide-fft" && fft_p5) {
          fft_p5.remove();
          fft_p5 = null;
        }
      });

      function toggleFullScreen() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }
      }

      window.onload = () => {
        setTimeout(() => {
          Reveal.slide(12);
        }, 300);
        // ask user if he wants to enter fullscreen
      };
    