
            // Cria WaveSurfer
            var source1 = WaveSurfer.create({
              container: "#source1",
              normalize: true,
              cursorColor: "#e01b24",
              splitChannels: true,
              minPxPerSec: 150,
              height: 100 // altura menor
            });

            source1.load("./saida.wav");

            // Controla play/pause com espaço quando o mouse estiver sobre o div
            let mouseOver = false;
            const audioDiv = document.getElementById("source1");

            audioDiv.addEventListener('mouseenter', () => mouseOver = true);
            audioDiv.addEventListener('mouseleave', () => mouseOver = false);

            document.addEventListener('keydown', (event) => {
              if(mouseOver && event.code === "Space") {
                event.preventDefault();
                source1.playPause(); // usa o WaveSurfer
              }
            });

            // Cria WaveSurfer
            var source2 = WaveSurfer.create({
              container: "#source2",
              normalize: true,
              cursorColor: "#e01b24",
              splitChannels: true,
              minPxPerSec: 150,
              height: 100 // altura menor
            });

            source2.load("./saida2.wav");

            // Controla play/pause com espaço quando o mouse estiver sobre o div
            let mouseOver2 = false;
            const audioDiv2 = document.getElementById("source2");

            audioDiv2.addEventListener('mouseenter', () => mouseOver2 = true);
            audioDiv2.addEventListener('mouseleave', () => mouseOver2 = false);

            document.addEventListener('keydown', (event) => {
              if(mouseOver2 && event.code === "Space") {
                event.preventDefault();
                source2.playPause(); // usa o WaveSurfer
              }
            });
          