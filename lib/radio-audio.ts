/**
 * Plays an announcement the way a radio would: a short squelch and two-tone chirp, then a
 * spoken voice, then a closing click. Browser-only. In production this audio would be pushed to
 * the volunteer's earpiece over the radio channel; here the phone speaker stands in for it.
 */
let ctx: AudioContext | null = null;

/** Call from a click handler so the browser allows sound later, when the timer fires. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = ctx ?? new AC();
  if (ctx.state === "suspended") void ctx.resume();
  // Some browsers only load voices after the first call.
  window.speechSynthesis?.getVoices();
}

function tone(freq: number, start: number, dur: number, gain = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}

function noise(start: number, dur: number, gain = 0.05) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + start);
}

export function playRadio(text: string, opts: { onStart?: () => void; onEnd?: () => void } = {}) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  const speak = () => {
    if (!synth) return opts.onEnd?.();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-AU";
    u.rate = 0.95;
    u.pitch = 0.9;
    const voices = synth.getVoices();
    const v = voices.find((x) => x.lang === "en-AU") ?? voices.find((x) => x.lang.startsWith("en"));
    if (v) u.voice = v;
    u.onend = () => {
      noise(0, 0.12);
      opts.onEnd?.();
    };
    u.onerror = () => opts.onEnd?.();
    synth.speak(u);
  };

  opts.onStart?.();
  if (ctx) {
    noise(0, 0.14);
    tone(1000, 0.14, 0.09);
    tone(1400, 0.25, 0.09);
    setTimeout(speak, 450);
  } else {
    speak();
  }
}

export function stopRadio() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
