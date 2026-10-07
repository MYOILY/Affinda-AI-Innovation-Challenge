/**
 * Plays an announcement the way a radio would: a short squelch and two-tone chirp, then a
 * spoken voice, then a closing click. Browser-only. In production this audio would be pushed to
 * the volunteer's earpiece over the radio channel; here the phone speaker stands in for it.
 *
 * Announcements play one at a time. Several reminders can be due in the same minute, and each
 * should be heard in full rather than cutting the one before it off.
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

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = "square") {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
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

/**
 * The sound that says "look at your phone". It is deliberately unlike the radio squelch so Mo can
 * tell an alert from an announcement without looking. A soft two-note chime for an alert, a
 * faster, higher triple beep for a CRITICAL incident. Call unlockAudio() from a click first.
 */
export type AlertLevel = "alert" | "critical";
let lastAlertAt = 0;
let lastAlertLevel: AlertLevel | null = null;

export function playAlert(level: AlertLevel = "alert") {
  if (typeof window === "undefined" || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  // Two things can fire in the same moment (an incident and a roster gap): sound once, loudest wins.
  const now = Date.now();
  if (now - lastAlertAt < 1500 && !(level === "critical" && lastAlertLevel !== "critical")) return;
  lastAlertAt = now;
  lastAlertLevel = level;
  if (level === "critical") {
    for (let i = 0; i < 3; i++) {
      tone(1320, i * 0.34, 0.14, 0.16, "square");
      tone(1760, i * 0.34 + 0.15, 0.14, 0.16, "square");
    }
  } else {
    tone(784, 0, 0.22, 0.2, "sine");
    tone(1175, 0.2, 0.45, 0.2, "sine");
  }
}

interface Item {
  text: string;
  onStart?: () => void;
  onEnd?: () => void;
}

const queue: Item[] = [];
let current: Item | null = null;

function run(item: Item) {
  current = item;
  item.onStart?.();
  const synth = window.speechSynthesis;
  let finished = false;
  const done = () => {
    if (finished || current !== item) return;
    finished = true;
    current = null;
    item.onEnd?.();
    pump();
  };
  // Some browsers never fire onend (no voices, muted tab), so never let the queue stall on one.
  const guard = setTimeout(done, Math.max(4000, item.text.length * 110));

  const speak = () => {
    if (!synth) return done();
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = "en-AU";
    u.rate = 0.95;
    u.pitch = 0.9;
    const voices = synth.getVoices();
    const v = voices.find((x) => x.lang === "en-AU") ?? voices.find((x) => x.lang.startsWith("en"));
    if (v) u.voice = v;
    u.onend = () => {
      noise(0, 0.12);
      clearTimeout(guard);
      done();
    };
    u.onerror = () => {
      clearTimeout(guard);
      done();
    };
    synth.speak(u);
  };

  if (ctx) {
    noise(0, 0.14);
    tone(1000, 0.14, 0.09);
    tone(1400, 0.25, 0.09);
    setTimeout(speak, 450);
  } else {
    speak();
  }
}

function pump() {
  if (current || !queue.length) return;
  run(queue.shift() as Item);
}

/** Queue an announcement. `interrupt` plays it now instead (used by Replay). */
export function playRadio(text: string, opts: { onStart?: () => void; onEnd?: () => void; interrupt?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (opts.interrupt) stopRadio();
  queue.push({ text, onStart: opts.onStart, onEnd: opts.onEnd });
  pump();
}

export function stopRadio() {
  if (typeof window === "undefined") return;
  queue.length = 0;
  const item = current;
  current = null;
  window.speechSynthesis?.cancel();
  item?.onEnd?.();
}
