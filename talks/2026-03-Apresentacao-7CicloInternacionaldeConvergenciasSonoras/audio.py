import wave
import struct
import math
import random

# -----------------------------
# FFT recursiva (Cooley-Tukey)
# -----------------------------
# random number between -5 and 5 with 2 decimal places
RANDOM_NUMBER = lambda: round(random.uniform(-1, 1), 2)


def fft(x):
    N = len(x)
    if N <= 1:
        return x
    if N % 2 != 0:
        raise ValueError("Length of x must be a power of 2")
    
    even = fft(x[0::2])
    odd = fft(x[1::2])
    add_k = RANDOM_NUMBER()

    
    T = [math.e ** (-2j * math.pi * (k + (k  *(add_k / 2))) / N) * odd[k] for k in range(N // 2)]
    
    return [even[k] + T[k] for k in range(N // 2)] + \
           [even[k] - T[k] for k in range(N // 2)]

# -----------------------------
# IFFT recursiva
# -----------------------------
def ifft(X):
    N = len(X)
    conj_X = [x.conjugate() for x in X]
    y = fft(conj_X)
    return [x.conjugate()/N for x in y]

# -----------------------------
# STFT
# -----------------------------
def stft(x, window_size=2048, hop_size=512):
    window = [0.5 - 0.5 * math.cos(2 * math.pi * n / window_size) for n in range(window_size)]  # Hann
    frames = []
    for start in range(0, len(x)-window_size+1, hop_size):
        frame = x[start:start+window_size]
        frame_windowed = [frame[n] * window[n] for n in range(window_size)]
        frames.append(fft(frame_windowed))
    return frames

# -----------------------------
# iSTFT
# -----------------------------
def istft(frames, window_size=2048, hop_size=512):
    window = [0.5 - 0.5 * math.cos(2 * math.pi * n / window_size) for n in range(window_size)]
    signal = [0.0] * (len(frames)*hop_size + window_size)
    for i, frame in enumerate(frames):
        time_frame = ifft(frame)
        for n in range(window_size):
            signal[i*hop_size + n] += time_frame[n].real * window[n]
    return signal

# -----------------------------
# Função utilitária para ler WAV
# -----------------------------
import soundfile as sf

def read_wav(filename):
    audio, sr = sf.read(filename)
    if audio.ndim > 1:
        audio = audio[:, 0]  # pega canal esquerdo
    return audio.tolist(), sr


# -----------------------------
# Função utilitária para escrever WAV
# -----------------------------
def write_wav(filename, signal, framerate):
    signal_int = [int(max(-1, min(1, s)) * 32767) for s in signal]
    data = struct.pack("<" + "h"*len(signal_int), *signal_int)
    with wave.open(filename, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(framerate)
        wf.writeframes(data)

# -----------------------------
# Exemplo de uso
# -----------------------------
if __name__ == "__main__":
    x, sr = read_wav("Vc-art_harm-A#5-mf-2c-N.wav")
    frames = stft(x)
    x_recon = istft(frames)
    write_wav("saida.wav", x_recon, sr)
