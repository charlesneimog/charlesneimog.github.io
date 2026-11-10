import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from pathlib import Path
import librosa
import OpenScofo

# Configuration
sr = 48000
fft_size = 2048
hop_size = 512

# audio = "/home/neimog/Nextcloud/Music-Resources/Samples/Orchidea/Winds/Flute/tongue_ram/Fl-tng_ram-D#4-mf-N-N.wav"
audio = "/home/neimog/Nextcloud/Music-Resources/Samples/Orchidea/Winds/Flute/jet_whistle/Fl-jet_wh-N-N-N-N.wav"

silence_threshold = 0.99
pitch_threshold = 0.9

# Initialize OpenScofo
oscofo = OpenScofo.OpenScofo(sr, fft_size, hop_size)
oscofo.activate_all_descriptors()

# Load audio
x, sr = librosa.load(
    audio,
    sr=sr,
)

# Extract descriptors
pitch_confidence = []
silence = []
times = []

for i in range(0, len(x) - fft_size + 1, hop_size):
    oscofo.process_block(x[i : i + fft_size])
    desc = oscofo.get_description()

    pitch_confidence.append(desc.pitch_confidence)
    silence.append(desc.silence)
    times.append((i + fft_size / 2) / sr)

print(silence)
print(pitch_confidence)

pitch_confidence = np.asarray(pitch_confidence)
silence = np.asarray(silence)
times = np.asarray(times)

# Gate classification (mutually exclusive)
silence_gate = silence >= silence_threshold

extended_gate = (~silence_gate) & (pitch_confidence < pitch_threshold)

pitch_gate = (~silence_gate) & (pitch_confidence >= pitch_threshold)

# Normalize audio for visualization only
max_amplitude = np.max(np.abs(x))
x_plot = x / max_amplitude if max_amplitude > 0 else x

audio_times = np.arange(len(x)) / sr

# Plot
plt.figure(figsize=(14, 5))

plt.plot(
    audio_times,
    x_plot,
    color="black",
    alpha=0.35,
    linewidth=0.5,
    label="Audio (normalized)",
)

plt.plot(
    times,
    pitch_confidence,
    color="blue",
    linewidth=1.5,
    label="Pitch confidence",
)

plt.plot(
    times,
    silence,
    color="gray",
    linewidth=1.5,
    label="Silence",
)

plt.axhline(
    pitch_threshold,
    color="black",
    linestyle="--",
    alpha=0.5,
    label="Pitch threshold (0.9)",
)


# Draw colored gate regions
def draw_gate(mask, color):
    if not np.any(mask):
        return

    changes = np.diff(np.concatenate(([False], mask, [False])).astype(int))

    starts = np.where(changes == 1)[0]
    ends = np.where(changes == -1)[0]

    for start, end in zip(starts, ends):
        left = max(0, start * hop_size / sr)
        right = min(len(x) / sr, end * hop_size / sr)

        plt.axvspan(
            left,
            right,
            color=color,
            alpha=0.20,
            linewidth=0,
        )


draw_gate(silence_gate, "gray")
draw_gate(extended_gate, "red")
draw_gate(pitch_gate, "green")

# Legend
legend_handles = [
    Patch(facecolor="gray", alpha=0.3, label="Silence gate"),
    Patch(facecolor="red", alpha=0.3, label="Extended technique gate"),
    Patch(facecolor="green", alpha=0.3, label="Pitch gate"),
]

handles, labels = plt.gca().get_legend_handles_labels()

plt.legend(
    handles=handles + legend_handles,
    labels=labels + [h.get_label() for h in legend_handles],
    loc="upper right",
)

# Formatting
plt.xlabel("Time (s)")
plt.ylabel("Normalized amplitude / Descriptor value")
plt.title(f"OpenScofo — Audio and Observation Gates — {Path(audio).name}")
plt.xlim(0, len(x) / sr)
plt.ylim(-1, 1)
plt.grid(alpha=0.2)
plt.tight_layout()
plt.show()
