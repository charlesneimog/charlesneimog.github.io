const slide8 = document.getElementById("slide8");

window.slideFFTIsVisible = false;

// using revel, check when slide2 is in view
var drawFrame;
let chunk;
let frameNumber;
let dftResult;
let fftPoints = 4096;
let sumImg, sumReal;
let prevX, prevY;
let micActive = false;
let mic;
let freq;
let audioChunks = [];
let samples;
let catetoA = 0;
let catetoB = 0;

let prevSample = undefined;
let prevCoord = undefined;

function dft(sequence, freq) {
  const N = fftPoints;
  const result = [];
  const k = freq;
  for (let n = 0; n < N; n++) {
    const complex = math.multiply(math.complex(0, (-2 * Math.PI) / N), k, n);
    result.push(math.multiply(math.pow(Math.E, complex), sequence[n]));
  }
  return result;
}

function normalizeSound(samples) {
  let maxAmplitude = samples[0];
  let newSamples = [...samples];

  for (let i = 0; i < fftPoints; i++) {
    newSamples[i] *= 2;
    if (newSamples[i] > maxAmplitude) {
      maxAmplitude = newSamples[i];
    }
  }
  if (maxAmplitude > 1) {
    return samples;
  } else {
    samples = newSamples;
  }

  if (maxAmplitude * 2 > 1) {
    return samples;
  } else {
    return normalizeSound(samples);
  }
}

// ============================
// ======== P5.JS CODE ========
// ============================
var slidefft_frames = 0;

let sketch_fft = function (p) {
  p.drawDFT = function () {
    samples = chunk.buffer.getChannelData(0);
    let samplesLen = samples.length;
    if (samplesLen < fftPoints) {
      alert("O áudio deve ter pelo menos 4.096 amostras.");
      return;
    }
    sampleIndex = 0;
    if (samplesLen > fftPoints * 4) {
      sampleIndex = Math.round(samplesLen / 2);
    }

    let fftPointsSamples = new Float32Array(fftPoints);
    for (let i = 0; i < fftPoints; i++) {
      fftPointsSamples[i] = samples[sampleIndex + i];
    }
    samples = normalizeSound(fftPointsSamples);

    freq = 440;
    index = Math.round(freq / (48000 / fftPoints));
    freq = index * (48000 / fftPoints);

    dftResult = dft(samples, index); // NOTE: HERE IS THE DFT
    frameNumber = 0;
    p.loop();
    p.clear();
    p.background(251, 251, 251);
    sumImg = 0;
    sumReal = 0;
    catetoA = 0;
    catetoB = 0;

    // center point
    p.stroke(0, 0, 255);
    p.fill(0, 0, 255);
    p.strokeWeight(10);
    p.point(width / 2, height / 2);

    // draw text in the center bottom of canvas
    p.stroke(0, 0, 0);
    p.fill(0, 0, 0);
    p.strokeWeight(1);
    p.textAlign(CENTER, CENTER);
    p.textSize(15);
    p.text("Análise de " + freq.toFixed(2) + "Hz.", width / 2, height - 20);
  };

  p.setup = function () {
    let w = document.getElementById("slide-fft-canvas").offsetWidth;
    document.getElementById("slide-fft-canvas").height = w;
    let localWidth = w;
    let localHeight = w;
    height = w;
    width = w;
    let myCanvas = p.createCanvas(localWidth, localHeight);
    myCanvas.parent("slide-fft-canvas");
    fftPoints = 4096;
    frameNumber = 0;
    p.background(251, 251, 251);
    p.frameRate(60);
    p.drawDFT();
    p.noLoop();
    setTimeout(() => {
      p.loop();
    }, 1000);
  };

  p.draw = function () {
    if (frameNumber > fftPoints - 1 || frameNumber === undefined) {
      return;
    }
    slidefft_frames += 1;
    var soundLength = fftPoints / (width - 20);
    for (let i = 0; i < fftPoints / 128; i++) {
      p.stroke(0, 0, 0);
      p.fill(0, 0, 0);
      p.strokeWeight(1);
      p.point(frameNumber / soundLength + 10, samples[frameNumber] * 20 + 20);

      let x = (dftResult[frameNumber].re + 1) * (height / 2);
      let y = (dftResult[frameNumber].im + 1) * (height / 2);
      sumReal += x;
      sumImg += y;
      catetoA += dftResult[frameNumber].re;
      catetoB += dftResult[frameNumber].im;
      p.strokeWeight(1);
      p.point(x, y);
      prevCoord = { x: x, y: y };
      prevSample = {
        x: frameNumber / soundLength + 10,
        y: samples[frameNumber] * 20 + 20,
      };
      prevX = x;
      prevY = y;
      frameNumber++;
      if (frameNumber > fftPoints - 1) {
        p.stroke(255, 0, 0);
        p.fill(255, 0, 0);
        p.strokeWeight(10);
        p.point(sumReal / fftPoints, sumImg / fftPoints);
        // make triangle
        p.strokeWeight(3);
        p.stroke(255, 255, 0);
        p.fill(255, 255, 0);
        p.line(width / 2, height / 2, sumReal / fftPoints, sumImg / fftPoints);

        p.stroke(0, 255, 0);
        p.fill(0, 255, 0);
        p.line(width / 2, height / 2, sumReal / fftPoints, height / 2);
        p.line(
          sumReal / fftPoints,
          sumImg / fftPoints,
          sumReal / fftPoints,
          height / 2,
        );

        p.stroke(200, 200, 0); // Valores mais baixos de R e G para tornar o amarelo mais escuro
        p.fill(200, 200, 0);
        p.strokeWeight(1);
        p.textAlign(CENTER, CENTER);
        p.textSize(15);

        let amp =
          Math.sqrt(catetoA * catetoA + catetoB * catetoB) / (fftPoints / 2);
        p.text("Amplitude = " + amp.toFixed(2), width / 2, height - 40);

        p.noLoop();
        return;
      }
    }
  };
};
