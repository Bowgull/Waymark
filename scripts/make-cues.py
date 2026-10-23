#!/usr/bin/env python3
"""The hard-run voice cues (page 76 "Hear it", option B): a game chime, then a
short voice. Every clip is pre-recorded here once and bundled with the app
(public/cues/*.m4a), so a cue plays with the screen off and no network.

Voice: Piper "Poppy" (en_GB-semaine-medium, speaker 3). The semaine voice
dataset is CC BY-NC-SA 4.0 (see public/cues/CREDITS.txt).

The clip names are the contract with src/lib/runSpeech.ts:

  phrases   run_hard easy_jog steady_hard easy_run five_k done halfway
            speed pace fast slow
  chimes    chime_hard chime_jog chime_nudge chime_done ticks
  numbers   n_<tenths>   3.0 .. 18.0 in 0.1 steps ("twelve point eight": n_128)
  paces     p_<m><ss>    3:30 .. 9:00 every second ("four forty-one": p_441)

Run (Piper's own Python, its espeak data, and afconvert on a Mac):

  ESPEAK_DATA_PATH=<piper>/bin/piper/espeak-ng-data \\
    <piper>/venv311/bin/python -I scripts/make-cues.py <voice.onnx> public/cues

Every clip: mono, trimmed, peak-normalised, AAC in .m4a at 22.05 kHz, 32 kb/s.
"""

import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

RATE = 22050
SPEAKER = 3

ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']


def words_under_60(n):
    if n < 20:
        return ONES[n]
    t, o = divmod(n, 10)
    return TENS[t] + ('' if o == 0 else '-' + ONES[o])


def number_words(tenths):
    """12.8 -> "twelve point eight"; 8.0 -> "eight"."""
    whole, frac = divmod(tenths, 10)
    return words_under_60(whole) if frac == 0 else f'{words_under_60(whole)} point {ONES[frac]}'


def pace_words(sec):
    """281 -> "four forty-one"; 305 -> "five oh five"; 360 -> "six flat"."""
    m, s = divmod(sec, 60)
    if s == 0:
        return f'{ONES[m]} flat'
    if s < 10:
        return f'{ONES[m]} oh {ONES[s]}'
    return f'{ONES[m]} {words_under_60(s)}'


PHRASES = {
    'run_hard': 'Run hard.',
    'easy_jog': 'Easy jog.',
    'steady_hard': 'Steady hard.',
    'easy_run': 'Easy run.',
    'five_k': 'Five K. As fast as you can.',
    'done': 'Done. Nice work.',
    'halfway': 'Halfway.',
    'speed': 'Speed',
    'pace': 'Pace',
    'fast': 'A bit fast. Ease to',
    'slow': 'Pick it up a little.',
}


def all_texts():
    out = dict(PHRASES)
    for t in range(30, 181):
        out[f'n_{t}'] = number_words(t) + '.'
    for s in range(210, 541):
        m, ss = divmod(s, 60)
        out[f'p_{m}{ss:02d}'] = pace_words(s) + '.'
    return out


# ── chimes (the mockup's option B tones, rendered once) ──

NOTE = {'C5': 523.25, 'E5': 659.25, 'G5': 783.99, 'C6': 1046.5, 'E6': 1318.5, 'G6': 1568.0}


def wave_at(kind, f, t):
    ph = (t * f) % 1.0
    if kind == 'square':
        return 1.0 if ph < 0.5 else -1.0
    return 4 * abs(ph - 0.5) - 1  # triangle


def render(tones, length):
    buf = [0.0] * int(length * RATE)
    for f, t0, dur, kind, vol in tones:
        start = int(t0 * RATE)
        n = int((dur + 0.02) * RATE)
        for i in range(n):
            j = start + i
            if j >= len(buf):
                break
            t = i / RATE
            # 8 ms attack, then an exponential fall to 0.0008 at `dur` (WebAudio's ramps).
            env = (t / 0.008) if t < 0.008 else math.exp(math.log(0.0008) * min(1.0, (t - 0.008) / max(1e-3, dur - 0.008)))
            buf[j] += wave_at(kind, f, t) * vol * env
    return buf


def chimes():
    hard = []
    for i, n in enumerate(['C5', 'E5', 'G5', 'C6']):
        hard += [(NOTE[n], i * 0.07, 0.16, 'square', 0.06), (NOTE[n] * 2, i * 0.07, 0.1, 'triangle', 0.03)]
    jog = [(NOTE[n], i * 0.11, 0.28, 'triangle', 0.12) for i, n in enumerate(['G5', 'E5', 'C5'])]
    nudge = [(NOTE[n], i * 0.12, 0.2, 'triangle', 0.07) for i, n in enumerate(['E5', 'C5'])]
    done = [(NOTE[n], d, 0.22, 'square', 0.05) for n, d in [('G5', 0), ('C6', 0.12), ('E6', 0.24), ('G6', 0.36)]]
    done += [(NOTE['C6'], 0.5, 0.7, 'triangle', 0.1), (NOTE['E6'], 0.5, 0.7, 'triangle', 0.06), (NOTE['G6'], 0.5, 0.7, 'triangle', 0.05)]
    ticks = [(1760 if i == 2 else 1320, i * 1.0, 0.06, 'triangle', 0.09) for i in range(3)]
    return {
        'chime_hard': render(hard, 0.5),
        'chime_jog': render(jog, 0.62),
        'chime_nudge': render(nudge, 0.42),
        'chime_done': render(done, 1.3),
        'ticks': render(ticks, 2.15),
    }


# ── audio helpers ──

def normalise(samples, peak=0.89):
    top = max((abs(s) for s in samples), default=0.0)
    if top <= 0:
        return samples
    k = peak / top
    return [s * k for s in samples]


def trim(samples, floor=0.012, pad_ms=30):
    idx = [i for i, s in enumerate(samples) if abs(s) > floor]
    if not idx:
        return samples
    pad = int(RATE * pad_ms / 1000)
    return samples[max(0, idx[0] - pad): min(len(samples), idx[-1] + pad)]


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(s * 32767)))) for s in samples))


def to_m4a(wav_path, out_path):
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac@22050', '-b', '32000', wav_path, out_path], check=True)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    model, out_dir = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(out_dir, exist_ok=True)
    from piper import PiperVoice
    from piper.config import SynthesisConfig
    espeak = os.environ.get('ESPEAK_DATA_PATH')
    voice = PiperVoice.load(model, espeak_data_dir=espeak) if espeak else PiperVoice.load(model)
    cfg = SynthesisConfig(speaker_id=SPEAKER, length_scale=1.0, normalize_audio=True)
    with tempfile.TemporaryDirectory() as tmp:
        jobs = list(all_texts().items())
        for k, (name, text) in enumerate(jobs):
            if only and name not in only:
                continue
            samples = []
            for chunk in voice.synthesize(text, syn_config=cfg):
                raw = chunk.audio_int16_bytes
                samples += [v / 32768 for v in struct.unpack('<%dh' % (len(raw) // 2), raw)]
            wav = os.path.join(tmp, name + '.wav')
            write_wav(wav, normalise(trim(samples)))
            to_m4a(wav, os.path.join(out_dir, name + '.m4a'))
            if k % 50 == 0:
                print(f'{k}/{len(jobs)} {name}: {text}', flush=True)
        for name, samples in chimes().items():
            if only and name not in only:
                continue
            wav = os.path.join(tmp, name + '.wav')
            write_wav(wav, normalise(samples, 0.7))
            to_m4a(wav, os.path.join(out_dir, name + '.m4a'))
    print('done', flush=True)


if __name__ == '__main__':
    main()
