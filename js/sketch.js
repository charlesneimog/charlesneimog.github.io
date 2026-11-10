let heroCanvas, heroDiv;
let fftPoints = 2048;
let sampleRate = 48000;
let time = [];
let signal = [];
let dftResult = [];
let kFreq;
let currentIndex = 1;
let noiseX = [];
let noiseY = [];
var Pd4Web = null;
let canvasBG;
let strokeCol;

// ─────────────────────────────────────
function slideFrom0To1(currentValue, step, delay) {
    if (currentValue > 1) return; // stop when reaching 1

    if (Pd4Web !== null) {
        // Pd4Web.sendFloat("gain", currentValue); // "slider" is the receiver name in Pd
    }

    setTimeout(() => {
        slideFrom0To1(currentValue + step, step, delay);
    }, delay);
}

// ─────────────────────────────────────
function generateSignalAndDFT() {
    time = [];
    signal = [];
    dftResult = [];
    noiseX = [];
    noiseY = [];

    for (let i = 0; i < fftPoints; i++) {
        let t = i / sampleRate;
        time.push(t);
        signal.push(sin(TWO_PI * 440 * t)); // pure sine wave
    }

    // Compute DFT for corresponding bin
    // random(200, 4000)
    kFreq = (440 * random(0.5, 2)) / (sampleRate / fftPoints);
    for (let n = 0; n < fftPoints; n++) {
        let angle = (-TWO_PI * kFreq * n) / fftPoints;
        let re = cos(angle) * signal[n];
        let im = sin(angle) * signal[n];
        dftResult.push({ re, im });
        noiseX[n] = random(0, 1);
        noiseY[n] = random(0, 1);
    }

    currentIndex = 1;

    // // center marker
    // stroke(255, 0, 0);
    // strokeWeight(8);
    // // point(width / 2, height / 2);

    //
    frameRate(10);
}

function setup() {
    heroDiv = document.getElementById("hero");

    const root = document.documentElement;
    canvasBG = getComputedStyle(root).getPropertyValue("--p5jscanvasbg").trim();
    strokeCol = getComputedStyle(root).getPropertyValue("--p5jstroke").trim();

    const divWidth = heroDiv.offsetWidth;
    const divHeight = heroDiv.offsetHeight;

    heroCanvas = createCanvas(divWidth, divHeight);
    heroCanvas.parent(heroDiv);
    heroCanvas.position(0, 0);
    heroCanvas.style("position", "absolute");
    heroCanvas.style("top", "0");
    heroCanvas.style("left", "0");
    heroCanvas.style("z-index", "-1");

    background(canvasBG);

    frameRate(50);
    generateSignalAndDFT();
}

let randomseedsent = false;
let transposition = 0;

let aziBuffer = [];
let maxPoints = 20;

function draw() {
    // Aplica um trail usando a cor do tema + opacidade
    push();
    noStroke();

    // Converte a cor CSS para RGBA do p5.js
    const col = color(canvasBG);
    col.setAlpha(18); // opacidade baixa para trail suave

    fill(col);
    rect(0, 0, width, height);
    pop();

    transposition = random(-2, 2);
    translate(width / 2 + transposition, height / 2 + transposition);

    let c = color(strokeCol);
    c.setAlpha(20); // opcional, 0–255
    stroke(c);

    strokeWeight(random(0.5, 1.5));
    noFill();

    if (currentIndex < dftResult.length) {
        let prev = dftResult[currentIndex - 1];
        let curr = dftResult[currentIndex];

        let scaleFactor = min(width, height) / 3;
        let noiseScale = min(width, height) / 10;

        let x1 = prev.re * scaleFactor + noiseX[currentIndex - 1] * noiseScale * random(0.01, 0.09);
        let y1 = prev.im * scaleFactor + noiseY[currentIndex - 1] * noiseScale * random(0.01, 0.09);
        let x2 = curr.re * scaleFactor + noiseX[currentIndex] * noiseScale * random(0.01, 0.09);
        let y2 = curr.im * scaleFactor + noiseY[currentIndex] * noiseScale * random(0.01, 0.09);

        let mx = (x1 + x2) / 2;
        let my = (y1 + y2) / 2;

        let t = millis() * 0.001;
        let controlOffset = noise(currentIndex * 0.015, t) * (min(width, height) * 0.015);
        let cx1 = mx + controlOffset * cos(t * 2);
        let cy1 = my + controlOffset * sin(t * 2);
        let cx2 = mx - controlOffset * sin(t * 3);
        let cy2 = my + controlOffset * cos(t * 3);

        bezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2);

        // Azimuth etc…
        let r = sqrt(x2 * x2 + y2 * y2);
        let azimuth = degrees(atan2(y2, x2));

        aziBuffer.push(azimuth);
        if (aziBuffer.length > maxPoints) aziBuffer.shift();

        let avgAzi = aziBuffer.reduce((a, b) => a + b, 0) / aziBuffer.length;

        if (Pd4Web !== null) {
            Pd4Web.sendFloat("azi", avgAzi);
        }

        currentIndex++;
    } else {
        currentIndex = 1;
    }
}

// Rebuild everything when the window changes size
function windowResized() {
    if (heroDiv) {
        resizeCanvas(heroDiv.offsetWidth, heroDiv.offsetHeight);
        generateSignalAndDFT(); // recompute everything to match new dimensions
    }
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", (e) => {
    if (e.matches) {
        noLoop();
        setup();
        loop();
    } else {
        noLoop();
        setup();
        loop();
    }
});
