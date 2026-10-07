"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportResult, RosterRow } from "@/lib/report";
import { advance, DEMO_START_MIN, fmtClock, LATE_RULE_MIN, pendingLate } from "@/lib/clock";
import {
  addCall,
  classifyRules,
  Classification,
  Incident,
  needsFirstAider,
  nearestFirstAider,
  openIncidents,
  Responder,
  responderMessage,
  Urgency,
} from "@/lib/incident";
import { fmtDuration, RELIEF_MIN, REMIND_EVERY_MIN, radioScript, RadioKind, sunWatch } from "@/lib/heat";
import { playAlert, playRadio, stopRadio, unlockAudio } from "@/lib/radio-audio";
import { RADIO_CALLS, RadioCall } from "@/lib/radio-calls";
import { applyPlan, coverageNow, generatePlan, markHeatOut, markNoShow, markRested } from "@/lib/roster";
import { summarisePlan } from "@/lib/summary";
import { Candidate, Move, NOW_SHIFT, NOW_TEMP_C, Notification, SHIFT_START, Strategy, Volunteer, World } from "@/lib/types";

interface Narration {
  source: "ai" | "template";
  summary?: string;
  messages?: Record<string, string>;
}

/** One announcement sent to a volunteer's earpiece. */
interface RadioMsg {
  id: string;
  kind: RadioKind;
  name: string;
  zone: string;
  at: number;
  text: string;
  source: "ai" | "template";
}

type Via = "typed" | "voice" | "audio";

/** The recorded walkie call currently coming in: playing, being transcribed, then read by Sharon. */
interface Inbound {
  id: string;
  label: string;
  playing: boolean;
  text?: string;
  /** true when the words came from a live transcription, false for the saved transcript. */
  live?: boolean;
}

const MEDICAL_NOSHOW = "Medical to base, Finn and Uma haven't turned up. We're two down, over.";
const NO_SHOW_AT = DEMO_START_MIN + LATE_RULE_MIN - 5;
/** Heat check starts after the 2:10 no-show window so it cannot flag Finn and Uma. */
const HEAT_START_MIN = NO_SHOW_AT + 1;
/** Pile-up lands a couple of minutes after the medical no-show has been signed off. */
const CHAOS_START_MIN = NO_SHOW_AT + 2;
/** Six overlapping walkie scraps: two incidents called twice (they merge), two more that must not be dropped. */
const CHAOS_CALLS = [
  "Gate A to base, the queue is backing up and people are pushing, over.",
  "Food Court, we've got a lost little girl, pink hat, about five, over.",
  "Yeah Gate A again, they're crushing at the front, stop the entry, over.",
  "Lawn Stage to base, someone collapsed by the barrier, need a medic NOW, over.",
  "Bar to base, two blokes fighting behind the bar, over.",
  "Lawn Stage again, she's not responding, send medics, over.",
];

const URGENCY_STYLE: Record<Urgency, { card: string; pill: string }> = {
  CRITICAL: { card: "border-4 border-red-500 bg-slate-900 text-white", pill: "bg-red-500 text-white" },
  HIGH: { card: "border-2 border-orange-500 bg-orange-50 text-slate-900", pill: "bg-orange-500 text-white" },
  MEDIUM: { card: "border-2 border-amber-400 bg-amber-50 text-slate-900", pill: "bg-amber-400 text-amber-950" },
  LOW: { card: "border border-slate-200 bg-white text-slate-900", pill: "bg-slate-200 text-slate-700" },
};

const untilOf = (m: Move) => {
  const last = m.shifts[m.shifts.length - 1];
  return last === "S1" ? "2pm" : last === "S2" ? "6pm" : "10pm";
};
const timeSpan = (m: Move) => (m.shifts[0] === NOW_SHIFT ? "now" : SHIFT_START[m.shifts[0]]) + " to " + untilOf(m);
/** One line on why this person: certificate, where they were posted, relevant experience. */
function whyLine(m: Move): string {
  const rank = (w: string) => (/certified/.test(w) ? 0 : /^(Posted at|Idle at)/.test(w) ? 1 : /first-responder/.test(w) ? 2 : /break/.test(w) ? 3 : 4);
  // The card subtitle already says where they are (posted at X / idle at hub), so keep only the rest.
  const trim = (w: string) =>
    w
      .replace(/^Posted at .+? as (.+), (\d+ min away)$/, "was on $1, $2")
      .replace(/^Idle at the hub, (\d+ min away), not on a post$/, "$1, not on a post");
  const ordered = [...m.why].filter((w) => !/^Refills/.test(w)).sort((a, b) => rank(a) - rank(b)).map(trim);
  return [...ordered.slice(0, 3), ...m.cautions].join(" · ");
}
const joinNames = (names: string[]) => (names.length < 3 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);

export default function Crewline({ initialVolunteers, world }: { initialVolunteers: Volunteer[]; world: World }) {
  const [clock, setClock] = useState(DEMO_START_MIN);
  const [vols, setVols] = useState(() => advance(world, initialVolunteers, DEMO_START_MIN).vols);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incLogOpen, setIncLogOpen] = useState(false);
  const chaosSeq = useRef(0);
  const [radio, setRadio] = useState<RadioMsg[]>([]);
  const [inbound, setInbound] = useState<Inbound | null>(null);
  const callAudio = useRef<HTMLAudioElement | null>(null);
  const callSeq = useRef(0);
  const callBusy = useRef(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(true);
  soundRef.current = soundOn;
  const volsRef = useRef(vols);
  volsRef.current = vols;
  /** Demo heat radio: two 1h 30m reminders, then the relieved line after Mo approves. */
  const remindShown = useRef(0);
  const clockSeq = useRef(0);
  const [running, setRunning] = useState(false);
  const [heardKind, setHeardKind] = useState<"radio" | "auto">("radio");
  const strategy: Strategy = "fast";
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [narration, setNarration] = useState<Narration | null>(null);
  const [sent, setSent] = useState<Notification[] | null>(null);
  const [medicalSolved, setMedicalSolved] = useState(false);
  const [heldSig, setHeldSig] = useState<string | null>(null);
  const [swapSeat, setSwapSeat] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [before, setBefore] = useState<Volunteer[] | null>(null);
  const [askWho, setAskWho] = useState<ReportResult["ambiguous"]>([]);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setCanSpeak("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }, []);

  const plan = useMemo(() => generatePlan(world, vols, { strategy, overrides }), [world, vols, strategy, overrides]);
  const hasPlan = plan.seats.length > 0;
  const held = heldSig === plan.signature;
  const covers = plan.moves.filter((m) => m.kind === "cover");

  // A new alert should be the first thing Mo sees: scroll to it and buzz her phone.
  const alertKey = hasPlan ? plan.seats.map((s) => s.zone + s.shifts.join("")).join("|") : "";
  const lastAlert = useRef("");
  useEffect(() => {
    if (alertKey && alertKey !== lastAlert.current) {
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      navigator.vibrate?.([120, 60, 120]);
      if (soundRef.current) playAlert("alert");
    }
    lastAlert.current = alertKey;
  }, [alertKey]);

  // A new serious incident is the first thing Mo sees, too.
  const topIncidents = openIncidents(incidents);
  const incidentKey = topIncidents.map((i) => `${i.id}:${i.urgency}:${i.calls.length}`).join("|");
  const lastIncident = useRef("");
  useEffect(() => {
    if (incidentKey && incidentKey !== lastIncident.current) {
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      navigator.vibrate?.(topIncidents[0]?.urgency === "CRITICAL" ? [250, 80, 250, 80, 250] : [120, 60, 120]);
      // Sound only for something new or worse, not when Mo clears an incident.
      const before = new Set(lastIncident.current.split("|"));
      const fresh = topIncidents.filter((i) => !before.has(`${i.id}:${i.urgency}:${i.calls.length}`));
      if (fresh.length && soundRef.current) playAlert(fresh.some((i) => i.urgency === "CRITICAL") ? "critical" : "alert");
    }
    lastIncident.current = incidentKey;
  }, [incidentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intruder / other CRITICAL security: if Mo has not acted in 10 seconds, keep beeping until she does.
  const nagId = topIncidents.find((i) => i.urgency === "CRITICAL" && i.category === "Security")?.id ?? "";
  useEffect(() => {
    if (!nagId) return;
    let beat: ReturnType<typeof setInterval> | undefined;
    const wait = setTimeout(() => {
      const ping = () => {
        if (!soundRef.current) return;
        playAlert("critical", { insist: true });
        navigator.vibrate?.([250, 80, 250, 80, 250]);
      };
      ping();
      beat = setInterval(ping, 2800);
    }, 10_000);
    return () => {
      clearTimeout(wait);
      if (beat) clearInterval(beat);
    };
  }, [nagId]);

  // The AI words the summary and texts. It cannot change who is moved.
  useEffect(() => {
    setNarration(null);
    if (!plan.moves.length) return;
    const ctrl = new AbortController();
    fetch("/api/narrate", {
      method: "POST",
      signal: ctrl.signal,
      body: JSON.stringify({
        context: `Sat ${fmtClock(clock)}, ${NOW_TEMP_C}°C`,
        moves: plan.moves.map((m) => ({
          volunteerId: m.volunteerId,
          name: m.name,
          kind: m.kind,
          source: m.source,
          fromZone: m.fromZone,
          toZone: m.toZone,
          role: m.role,
          when: m.shifts[0] === NOW_SHIFT ? "now" : SHIFT_START[m.shifts[0]],
          until: untilOf(m),
          etaMin: m.etaMin,
          why: m.why,
          cautions: m.cautions,
          draft: m.message,
        })),
      }),
    })
      .then((r) => r.json())
      .then(setNarration)
      .catch(() => {});
    return () => ctrl.abort();
  }, [plan.signature]);

  const messageOf = (m: Move) => edits[m.volunteerId] ?? narration?.messages?.[m.volunteerId] ?? m.message;
  const summary = narration?.summary ?? summarisePlan(plan);

  // ---- report in -------------------------------------------------------
  const roster: RosterRow[] = useMemo(
    () =>
      vols
        .filter((v) => (v.status === "on_shift" || v.status === "on_break" || v.status === "en_route" || v.status === "expected") && v.satShifts.includes(NOW_SHIFT))
        .map((v) => ({ id: v.id, name: v.name, firstName: v.firstName, zone: v.satZone, role: v.satRole })),
    [vols],
  );

  const applyEvents = (base: Volunteer[], events: ReportResult["events"]) => {
    let next = base;
    for (const e of events) next = e.kind === "no_show" ? markNoShow(next, e.volunteerId) : markHeatOut(next, e.volunteerId);
    return next;
  };

  const describe = (events: ReportResult["events"]) =>
    events.map((e) => {
      const v = vols.find((x) => x.id === e.volunteerId)!;
      return `${v.name} ${e.kind === "no_show" ? "not here" : "resting (heat)"}`;
    });

  // One door for everything Mo hears: typed, spoken, or a recorded walkie call. Each
  // transmission is read twice, in parallel: for roster changes (who is missing, who is in
  // trouble) and as an incident (how urgent, where, what to do).
  const ingest = async (raw: string, via: Via = "typed", at = clock) => {
    const t = raw.trim();
    if (!t) return;
    const zones = world.zones.map((z) => z.zone);
    const [res, cls]: [ReportResult, Classification] = await Promise.all([
      fetch("/api/report", { method: "POST", body: JSON.stringify({ text: t, roster }) }).then((r) => r.json()),
      fetch("/api/incident", { method: "POST", body: JSON.stringify({ text: t, zones }) })
        .then((r) => r.json())
        .catch(() => classifyRules(t)),
    ]);

    // A heat report that already became a roster alert does not also need an incident card.
    const rosterHit = res.events.length > 0 || res.ambiguous.length > 0;
    const wantIncident = cls.category === "Routine" ? !rosterHit && !res.unclear : !(rosterHit && cls.category === "Heat");
    if (wantIncident) {
      setIncidents((log) => addCall(log, cls, { text: t, at, via }).log);
      if (cls.category === "Routine") setNote("Logged. Nothing to do.");
    }

    if (res.events.length) {
      setBefore(vols);
      setHeardKind("radio");
      setHeard(describe(res.events));
      setVols(applyEvents(vols, res.events));
      setSent(null);
      setOverrides({});
      setHeldSig(null);
    } else {
      setHeard([]);
    }
    if (res.ambiguous.length) setAskWho(res.ambiguous);
    if (!rosterHit && !wantIncident) {
      setNote(res.unclear ? "I couldn't tell who. Say a name." : "No roster change in that.");
    }
  };

  const send = async (raw: string, via: Via = "typed") => {
    if (!raw.trim() || busy) return;
    unlockAudio(); // a tap or Enter is what lets the alert sound play later
    setBusy(true);
    setNote(null);
    setAskWho([]);
    try {
      await ingest(raw, via);
      setText("");
    } catch {
      setNote("Couldn't read that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Overlapping scraps land one after another so Mo sees merges and the ones that must not be dropped. */
  const playChaos = async () => {
    if (busy || running || !medicalSolved) return;
    unlockAudio();
    const seq = ++chaosSeq.current;
    setBusy(true);
    setNote(null);
    setAskWho([]);
    try {
      if (clock < CHAOS_START_MIN) {
        const dt = CHAOS_START_MIN - clock;
        const jumped = advance(world, volsRef.current, CHAOS_START_MIN, dt, false, true);
        volsRef.current = jumped.vols;
        setVols(jumped.vols);
        setClock(CHAOS_START_MIN);
      }
      const at = Math.max(clock, CHAOS_START_MIN);
      for (let i = 0; i < CHAOS_CALLS.length; i++) {
        if (seq !== chaosSeq.current) return;
        const text = CHAOS_CALLS[i];
        setInbound({ id: `chaos-${i}`, label: "Radio pile-up", playing: true, text, live: false });
        await ingest(text, "typed", at);
        if (i < CHAOS_CALLS.length - 1) await new Promise((r) => setTimeout(r, 550));
      }
      if (seq === chaosSeq.current) setIncLogOpen(true);
    } catch {
      setNote("Couldn't read that. Try again.");
    } finally {
      if (seq === chaosSeq.current) {
        setBusy(false);
        setInbound(null);
      }
    }
  };

  const pickWho = (a: ReportResult["ambiguous"][number], id: string) => {
    const ev = [{ kind: a.kind, volunteerId: id }];
    setBefore(vols);
    setHeard(describe(ev));
    setVols(applyEvents(vols, ev));
    setAskWho(askWho.filter((x) => x !== a));
    setSent(null);
    setOverrides({});
  };

  const undo = () => {
    if (!before) return;
    setVols(before);
    setBefore(null);
    setHeard([]);
    setOverrides({});
  };

  const listen = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, new () => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.onresult = (e: { results: { 0: { transcript: string } }[] }) => {
      const t = e.results[0][0].transcript;
      setText(t);
      send(t, "voice");
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  // ---- a recorded walkie call comes in -------------------------------------
  // The real recording plays out loud while it is transcribed (live when a key is set, the saved
  // transcript otherwise). The words then go through the same intake as everything else.
  const stopCall = () => {
    callSeq.current++;
    callBusy.current = false;
    callAudio.current?.pause();
    callAudio.current = null;
    setInbound(null);
  };

  const playCall = async (call: RadioCall) => {
    // One call at a time: a double tap must not report the same transmission twice.
    if (busy || callBusy.current) return;
    callBusy.current = true;
    unlockAudio();
    stopRadio();
    callAudio.current?.pause();
    const seq = ++callSeq.current;
    const audio = new Audio(call.file);
    callAudio.current = audio;
    const idle = () => setInbound((p) => (p && p.id === call.id && callAudio.current === audio ? { ...p, playing: false } : p));
    setInbound({ id: call.id, label: call.label, playing: soundRef.current });

    // Play the recording and transcribe at the same time. The incident card waits until the
    // audio has finished, so Mo hears the call before the alert pops.
    const heard = new Promise<void>((resolve) => {
      if (!soundRef.current) {
        resolve();
        return;
      }
      const done = () => {
        idle();
        resolve();
      };
      audio.onended = done;
      audio.onpause = done;
      audio.onerror = done;
      audio.play().catch(done);
    });

    let words = call.transcript;
    let live = false;
    try {
      const blob = await fetch(call.file).then((r) => r.blob());
      const body = new FormData();
      body.append("file", new File([blob], call.file.split("/").pop() ?? "call.mp3", { type: blob.type || "audio/mpeg" }));
      const res = await fetch("/api/transcribe", { method: "POST", body });
      const data = await res.json();
      if (res.ok && data.text) {
        words = data.text;
        live = true;
      }
    } catch {}
    try {
      if (seq !== callSeq.current) return;
      setInbound((p) => (p && p.id === call.id ? { ...p, text: words, live } : p));
      await heard;
      if (seq !== callSeq.current) return;
      await send(words, "audio");
    } finally {
      if (seq === callSeq.current) callBusy.current = false;
    }
  };

  // ---- incidents: Mo decides ---------------------------------------------
  const handleIncident = (id: string, note?: string) =>
    setIncidents((log) => log.map((i) => (i.id === id ? { ...i, status: "handled", handledNote: note } : i)));

  /** Mo taps "Send Vivian": she is messaged and leaves the idle pool, so any plan re-searches without her. */
  const sendResponder = (inc: Incident, r: Responder) => {
    const v = vols.find((x) => x.id === r.volunteerId);
    if (!v) return;
    setVols(vols.map((x) => (x.id === v.id ? { ...x, status: "en_route" as const, currentZone: inc.zone ?? x.currentZone } : x)));
    setSent((prev) => [...(prev ?? []), { volunteerId: v.id, name: v.name, phone: v.phone, message: responderMessage(r, inc) }]);
    handleIncident(inc.id, `${r.name} sent · ${r.etaMin} min`);
    setOverrides({});
  };

  // ---- radio to the earpiece ---------------------------------------------
  const play = (m: Pick<RadioMsg, "id" | "text">, interrupt = false) =>
    playRadio(m.text, {
      interrupt,
      onStart: () => setPlaying(m.id),
      onEnd: () => setPlaying((p) => (p === m.id ? null : p)),
    });

  /** Write the announcement (the AI may word it, a template is the fallback), log it and play it. */
  const announce = async (kind: RadioKind, v: Volunteer, at: number) => {
    const facts = { kind, firstName: v.firstName, zone: v.satZone, sunMin: v.sunMin, tempC: NOW_TEMP_C };
    let text = radioScript(facts);
    let source: RadioMsg["source"] = "template";
    try {
      const r = await fetch("/api/radio", { method: "POST", body: JSON.stringify(facts) }).then((x) => x.json());
      if (typeof r.text === "string" && r.text) {
        text = r.text;
        source = r.source === "ai" ? "ai" : "template";
      }
    } catch {}
    const msg: RadioMsg = { id: `${kind}-${v.id}-${at}`, kind, name: v.name, zone: v.satZone, at, text, source };
    setRadio((prev) => [msg, ...prev]);
    navigator.vibrate?.(80);
    if (soundRef.current) play(msg);
  };

  // ---- sign off ----------------------------------------------------------
  const approve = () => {
    unlockAudio();
    const final = { ...plan, moves: plan.moves.map((m) => ({ ...m, message: messageOf(m) })) };
    const { vols: applied, notifications } = applyPlan(vols, final);
    // Anyone the heat monitor pulled off a post is now released: tell them over the radio too.
    const relieved = vols.filter((v) => v.status === "heat_out" && v.reliefDue);
    const next = markRested(applied, relieved.map((v) => v.id));
    relieved.forEach((v) => announce("relieved", v, clock));
    if (plan.seats.some((s) => s.zone === "Medical Tent")) setMedicalSolved(true);
    setVols(next);
    setSent(notifications);
    setBefore(null);
    setHeard([]);
    setOverrides({});
    setEdits({});
    setSwapSeat(null);
  };

  const reset = () => {
    stopCall();
    clockSeq.current += 1;
    setClock(DEMO_START_MIN);
    setRunning(false);
    setHeardKind("radio");
    setVols(advance(world, initialVolunteers, DEMO_START_MIN).vols);
    stopRadio();
    setRadio([]);
    chaosSeq.current += 1;
    setIncidents([]);
    setIncLogOpen(false);
    setPlaying(null);
    setOverrides({});
    setEdits({});
    setSent(null);
    setMedicalSolved(false);
    setHeldSig(null);
    setHeard([]);
    setBefore(null);
    setAskWho([]);
    setNote(null);
    remindShown.current = 0;
  };

  // ---- the agent watches the clock ---------------------------------------
  // People who have not checked in LATE_RULE_MIN minutes after shift start are flagged by the
  // agent itself. Nobody has to notice or report them.
  // The same loop watches sun time (when `heat` is on). Every 1h 30m in the sun, Sharon sends the
  // volunteer a radio reminder to drink water and find shade. At 2h 30m she recommends relief and
  // drafts the swap for approval. The clock stops whenever Sharon needs a decision, so the room sees it.
  const runClockTo = (target: number, heat = false) => {
    if (running) return;
    unlockAudio();
    const seq = ++clockSeq.current;
    setRunning(true);
    let t = clock;
    // Jump past 2:10 without flagging no-shows, so heat and medical stay separate demos.
    if (heat && t < HEAT_START_MIN) {
      const dt = HEAT_START_MIN - t;
      const jumped = advance(world, volsRef.current, HEAT_START_MIN, dt, false, true);
      volsRef.current = jumped.vols;
      setVols(jumped.vols);
      t = HEAT_START_MIN;
      setClock(t);
      if (target < t + 75) target = t + 75;
    }
    const step = () => {
      if (seq !== clockSeq.current) return;
      t += 1;
      setClock(t);
      const res = advance(world, volsRef.current, t, 1, heat, heat);
      let next = res.vols;
      const lines: string[] = [];
      if (res.flagged.length) {
        lines.push(`${joinNames(res.flagged.map((v) => v.name))} still not checked in ${LATE_RULE_MIN} min after the 2pm start`);
      }
      // Reminders are routine and need nobody's say-so, so they go out and the clock keeps running.
      // The demo only plays two of them (Marcus, then Chloe) so the room is not a queue of names.
      for (const v of res.reminded) {
        if (remindShown.current >= 2) continue;
        remindShown.current += 1;
        announce("reminder", v, t);
      }
      // Relief takes someone off a post, so it stops the clock and waits for approval.
      if (res.reliefDue.length) {
        for (const v of res.reliefDue) next = markHeatOut(next, v.id);
        lines.push(`${joinNames(res.reliefDue.map((v) => `${v.name} ${fmtDuration(v.sunMin)} in the sun`))}. Relief recommended`);
      }
      volsRef.current = next;
      setVols(next);
      const noticed = lines.length > 0;
      if (noticed) {
        setBefore(null);
        setSent(null);
        setHeldSig(null);
        setOverrides({});
        setHeardKind("auto");
        setHeard(lines);
      }
      if (seq !== clockSeq.current) return;
      if (!noticed && t < target) setTimeout(step, 420);
      else setRunning(false);
    };
    setTimeout(step, 400);
  };
  const late = pendingLate(vols, clock).filter((l) => l.minutesLate < LATE_RULE_MIN);
  const watch = sunWatch(vols);
  // Heat check can run whenever someone on a post is still in the sun and not yet flagged for relief.
  const heatLeft = vols.some((v) => v.status === "on_shift" && !v.reliefDue && v.sunMin > 0);

  // ---- headline ----------------------------------------------------------
  const lead = plan.seats.filter((s) => s.urgent).length ? plan.seats.filter((s) => s.urgent) : plan.seats;
  const leadZones = [...new Set(lead.map((s) => s.zone))];
  const title = leadZones.length === 1 ? `${leadZones[0]} short ${lead.length}` : `${lead.length} posts short`;
  const notHere = [...new Set(plan.seats.flatMap((s) => s.because))];
  const resting = [...new Set(plan.seats.flatMap((s) => s.becauseHeat))];
  const laterToo = plan.seats.some((s) => s.shifts.some((x) => x !== NOW_SHIFT));
  const reason = [
    notHere.length ? `${joinNames(notHere)} not here.` : "",
    resting.length ? `${joinNames(resting)} ${resting.length === 1 ? "needs" : "need"} a break from the heat.` : "",
    laterToo ? "6pm shift affected too." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const coverage = coverageNow(world, vols);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-slate-100 text-sm">
      <header className="relative z-10 flex shrink-0 items-center justify-between bg-slate-900 px-3 py-1.5 text-white md:pt-7">
        <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crewline-logo.png" alt="" className="h-5 w-auto" />
          Crewline
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span>
            Sat {fmtClock(clock)} · <span className="font-semibold text-orange-300">{NOW_TEMP_C}°C</span>
          </span>
          <button onClick={() => setSoundOn(!soundOn)} className="rounded-full bg-white/10 px-2 py-0.5 font-medium text-slate-200">
            Sound {soundOn ? "on" : "off"}
          </button>
        </div>
      </header>

      <main ref={mainRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {/* Incidents from the radio: the most urgent thing on screen, with the move to make */}
        {topIncidents.slice(0, 2).map((i) => (
          <IncidentCard
            key={i.id}
            incident={i}
            responder={needsFirstAider(i) ? nearestFirstAider(world, vols, i.zone) : null}
            onSend={(r) => sendResponder(i, r)}
            onHandled={() => handleIncident(i.id, "Marked handled")}
            onCall000={() => handleIncident(i.id, "Called 000")}
          />
        ))}
        {topIncidents.length > 2 && <div className="px-1 text-xs font-medium text-slate-600">+{topIncidents.length - 2} more open in the incident log below</div>}

        {/* Needs a word from Mo before we can plan */}
        {askWho.map((a) => (
          <div key={a.word} className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3">
            <div className="text-sm font-bold text-amber-950">Which {a.word}?</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {a.options.map((o) => (
                <button key={o.id} onClick={() => pickWho(a, o.id)} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold shadow-sm">
                  {o.name} · {o.zone}
                </button>
              ))}
            </div>
          </div>
        ))}
        {/* The radio call as it arrives: the real recording, its words, and whether they were heard live */}
        {inbound && (
          <section className="rounded-2xl bg-slate-900 p-3 text-white">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 font-bold uppercase tracking-wider">
                <span className={`h-2.5 w-2.5 rounded-full ${inbound.playing ? "animate-pulse bg-red-500" : "bg-slate-500"}`} />
                Radio in
              </span>
              <span className="text-slate-400">
                {inbound.playing ? "Receiving…" : inbound.text ? (inbound.live ? "Transcribed live" : "Saved transcript") : "Transcribing…"}
              </span>
            </div>
            {inbound.text ? (
              <p className="mt-2 text-sm italic leading-snug">&ldquo;{inbound.text}&rdquo;</p>
            ) : (
              <p className="mt-2 text-xs text-slate-400">Transcribing the call…</p>
            )}
          </section>
        )}
        {note && <div className="rounded-xl bg-slate-200 px-3 py-2.5 text-xs text-slate-700">{note}</div>}

        {/* The agent is watching the clock: late check-ins, before they become an alert */}
        {late.length > 0 && (
          <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-800">Not checked in</div>
              <div className="text-xs font-medium text-amber-900">Sharon steps in at {LATE_RULE_MIN} min</div>
            </div>
            <ul className="mt-2 space-y-1.5">
              {late.map((l) => (
                <li key={l.volunteer.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">
                      {l.volunteer.name} <span className="font-normal text-amber-900">· {l.volunteer.satZone}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{l.minutesLate} min late</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-200">
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, (l.minutesLate / LATE_RULE_MIN) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ALERT + ACTION: everything Mo needs on first glance */}
        {hasPlan ? (
          <>
            <section className="rounded-2xl bg-red-600 p-3 text-white shadow-lg">
              <div className="text-xs font-bold uppercase tracking-widest text-red-100">Alert</div>
              <h1 className="mt-0.5 text-xl font-extrabold leading-none">{title}</h1>
              {reason && <p className="mt-2 text-sm leading-snug text-red-50">{reason}</p>}
              {heard.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/25 pt-2 text-xs text-red-100">
                  <span>
                    <span className="font-semibold text-white">{heardKind === "auto" ? `Sharon noticed at ${fmtClock(clock)}` : "Heard"}:</span> {heard.join(", ")}
                  </span>
                  {before && (
                    <button onClick={undo} className="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 font-semibold text-white">
                      Undo
                    </button>
                  )}
                </div>
              )}
            </section>

            {!held ? (
              <section className="rounded-2xl border-2 border-emerald-600 bg-white p-3 shadow-lg">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-bold uppercase tracking-widest text-emerald-700">Sharon&apos;s proposal</div>
                  <div className="text-xs font-semibold text-slate-600">
                    {plan.coverEtaMin ? `covered in ~${plan.coverEtaMin} min` : "needs you"}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Searched {plan.search.onSitePool} people on site · {plan.search.eligible} eligible · {plan.search.options.toLocaleString()} possible plans
                  {plan.search.complete ? ", best one proven" : ""}
                </div>

                <ul className="mt-2 divide-y divide-slate-100">
                  {covers.map((m) => {
                    const refill = plan.moves.find((x) => x.refillsFor === m.volunteerId);
                    return (
                      <li key={m.id} className="py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold leading-tight">{m.name}</div>
                            <div className="text-xs text-slate-600">
                              {m.source === "onsite" ? `Posted at ${m.fromZone}` : "Idle at hub"} → <span className="font-semibold text-slate-900">{m.toZone}</span>
                            </div>
                            <div className="mt-0.5 text-xs leading-snug text-slate-600">{whyLine(m)}</div>
                          </div>
                          <div className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1.5 text-center">
                            <div className="text-sm font-bold leading-none tabular-nums">{m.etaMin}</div>
                            <div className="text-[10px] uppercase text-slate-500">min</div>
                          </div>
                        </div>
                        {refill && (
                          <div className="mt-1 text-xs text-slate-500">
                            then {refill.name} (idle at hub, {refill.etaMin} min) refills {refill.toZone}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {plan.open.length > 0 && (
                  <div className="mt-1 rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">
                    Still open: {plan.open.map((o) => `${o.zone} ${o.shifts.join("+")}`).join(", ")}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <button onClick={approve} className="rounded-xl bg-emerald-600 py-2.5 text-sm font-extrabold text-white active:bg-emerald-700">
                    Approve · message {plan.moves.length}
                  </button>
                  <button onClick={() => setHeldSig(plan.signature)} className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold">
                    Hold
                  </button>
                </div>
                <div className="mt-2 text-center text-xs text-slate-500">Nobody is messaged or moved until you approve.</div>
              </section>
            ) : (
              <section className="rounded-2xl border-2 border-slate-300 bg-white p-3">
                <h2 className="font-semibold">On hold. Nobody has been messaged.</h2>
                <button className="mt-2 w-full rounded-xl bg-slate-900 py-2 text-sm font-semibold text-white" onClick={() => setHeldSig(null)}>
                  Reopen
                </button>
              </section>
            )}

            {/* Everything optional lives below the fold */}
            {!held && (
              <details className="rounded-2xl bg-white p-3">
                <summary className="cursor-pointer text-xs font-semibold">Change this plan</summary>
                <p className="mt-2 text-xs text-slate-700">
                  {summary}{" "}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${narration?.source === "ai" ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600"}`}>
                    {narration?.source === "ai" ? "AI worded" : "auto"}
                  </span>
                </p>
                <div className="mt-2 space-y-2">
                  {covers.map((m) => (
                    <MoveCard
                      key={m.id}
                      move={m}
                      refill={plan.moves.find((x) => x.refillsFor === m.volunteerId)}
                      swapOpen={swapSeat === m.seatId}
                      onToggleSwap={() => setSwapSeat(swapSeat === m.seatId ? null : m.seatId)}
                      onPick={(c) => {
                        setOverrides({ ...overrides, [m.seatId]: c.volunteerId });
                        setSwapSeat(null);
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                  <div className="text-xs font-semibold">Texts to send ({plan.moves.length})</div>
                  {plan.moves.map((m) => (
                    <label key={m.id} className="block">
                      <span className="text-xs font-semibold text-slate-500">{m.name}</span>
                      <textarea
                        value={messageOf(m)}
                        onChange={(e) => setEdits({ ...edits, [m.volunteerId]: e.target.value })}
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : null}

        {/* What the agent already did by itself: radio announcements to earpieces */}
        {radio.length > 0 && (
          <section className="rounded-2xl border-2 border-orange-400 bg-orange-50 p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-orange-800">Radio · sent to earpiece</div>
              <div className="text-xs text-orange-900">Sent automatically</div>
            </div>
            <ul className="mt-2 space-y-2">
              {radio.slice(0, 3).map((r) => (
                <li key={r.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-bold">
                        {r.kind === "reminder" ? "Heat reminder" : "Relieved"} · {r.name}
                      </div>
                      <div className="text-xs text-orange-900">
                        {r.zone} · {fmtClock(r.at)}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        unlockAudio();
                        play(r, true);
                      }}
                      className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${playing === r.id ? "animate-pulse bg-orange-600 text-white" : "bg-white text-orange-900"}`}
                    >
                      {playing === r.id ? "Playing…" : "Replay"}
                    </button>
                  </div>
                  <p className="mt-1.5 rounded-lg bg-white/70 px-2.5 py-2 text-xs italic leading-snug text-slate-800">&ldquo;{r.text}&rdquo;</p>
                  {r.source === "ai" && <div className="mt-1 text-[10px] font-semibold uppercase text-violet-700">AI worded</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Everything that came over the radio, newest first */}
        {incidents.length > 0 && (
          <details
            className="rounded-2xl bg-white p-3"
            open={incLogOpen}
            onToggle={(e) => setIncLogOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-xs font-semibold">Incident log ({incidents.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {incidents.map((i) => (
                <li key={i.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${URGENCY_STYLE[i.urgency].pill}`}>{i.urgency}</span>
                    <span className="text-xs text-slate-500">
                      {fmtClock(i.at)} · {i.status === "open" ? "open" : i.handledNote ?? "handled"}
                    </span>
                  </div>
                  <div className="mt-1 font-semibold leading-tight">{i.summary}</div>
                  <div className="text-xs text-slate-500">
                    {i.category}
                    {i.calls.length > 1 ? ` · ${i.calls.length} calls merged` : ""}
                  </div>
                  <p className="mt-1 text-xs italic text-slate-600">&ldquo;{i.calls[i.calls.length - 1].text}&rdquo;</p>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* After sign-off */}
        {sent && (
          <details className="rounded-2xl bg-white p-3" open>
            <summary className="cursor-pointer font-semibold text-emerald-800">Messaged {sent.length} {sent.length === 1 ? "person" : "people"} · roster updated</summary>
            <ul className="mt-2 space-y-2">
              {sent.map((n) => (
                <li key={n.volunteerId} className="text-xs">
                  <span className="font-medium">{n.name}</span> <span className="text-slate-400">{n.phone}</span>
                  <p className="text-slate-600">{n.message}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">Simulated SMS.</p>
          </details>
        )}

        <details className="rounded-2xl bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold">Roster now</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {coverage.map((r) => (
              <li key={r.zone + r.role} className="flex items-center justify-between py-1.5 text-xs">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${r.have >= r.need ? "bg-emerald-500" : "bg-red-500"}`} />
                  {r.zone} <span className="text-xs text-slate-400">{r.role}</span>
                </span>
                <span className={`font-semibold tabular-nums ${r.have >= r.need ? "" : "text-red-600"}`}>
                  {r.have}/{r.need}
                </span>
              </li>
            ))}
          </ul>
        </details>

        <details className="rounded-2xl bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold">Heat watch </summary>
          <div className="mt-2 text-xs text-slate-500">
            Sharon reminds everyone every {fmtDuration(REMIND_EVERY_MIN)} in the sun, and recommends relief at {fmtDuration(RELIEF_MIN)}.
          </div>
          <ul className="mt-2 space-y-1.5">
            {watch.slice(0, 3).map((r) => (
              <SunRow key={r.volunteer.id} row={r} />
            ))}
            {watch.length === 0 && <li className="text-xs text-slate-500">Nobody on a sunny post yet.</li>}
          </ul>
          {watch.length > 3 && (
            <ul className="mt-2 space-y-1.5">
              {watch.slice(3, 15).map((r) => (
                <SunRow key={r.volunteer.id} row={r} />
              ))}
            </ul>
          )}
        </details>

        <button onClick={reset} className="w-full py-2 text-xs font-medium text-slate-400 underline">
          Reset demo to {fmtClock(DEMO_START_MIN)}
        </button>
      </main>

      {/* Report in: always one thumb away, like a chat box */}
      <div className="z-20 shrink-0 border-t border-slate-300 bg-white p-2 md:pb-3">
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">Demo</span>
          {RADIO_CALLS.map((c) => (
            <button
              key={c.id}
              onClick={() => playCall(c)}
              disabled={busy}
              className="shrink-0 rounded-full bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-900 disabled:opacity-40"
            >
              &#9654; {c.label}
            </button>
          ))}
          <button
            onClick={() => runClockTo(Math.max(clock, HEAT_START_MIN) + 75, true)}
            disabled={running || !heatLeft}
            className="shrink-0 rounded-full bg-orange-100 px-3 py-1.5 text-xs font-semibold text-orange-900 disabled:opacity-40"
          >
            {running ? "Watching…" : "Heat check"}
          </button>
          <button
            onClick={() => (clock < NO_SHOW_AT ? runClockTo(NO_SHOW_AT) : send(MEDICAL_NOSHOW))}
            disabled={running || busy}
            className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40"
          >
            {running && clock < NO_SHOW_AT ? "Waiting…" : "Medical: two haven't shown"}
          </button>
          <button
            onClick={playChaos}
            disabled={running || busy || !medicalSolved}
            className="shrink-0 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-900 disabled:opacity-40"
          >
            {inbound?.id.startsWith("chaos") ? "Coming in…" : "Pile-up: 6 calls"}
          </button>
        </div>
        <div className="flex gap-2">
          {canSpeak && (
            <button
              onClick={listen}
              aria-label="Speak"
              className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${listening ? "animate-pulse bg-red-600 text-white" : "bg-slate-900 text-white"}`}
            >
              {listening ? "Listening…" : "Speak"}
            </button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(text)}
            placeholder="Report what you heard"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button
            onClick={() => send(text)}
            disabled={!text.trim() || busy}
            className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One open incident: how bad, where, what to do. Mo taps one button. */
function IncidentCard({
  incident: i,
  responder,
  onSend,
  onHandled,
  onCall000,
}: {
  incident: Incident;
  responder: Responder | null;
  onSend: (r: Responder) => void;
  onHandled: () => void;
  onCall000?: () => void;
}) {
  const dark = i.urgency === "CRITICAL";
  const sub = dark ? "text-slate-300" : "text-slate-600";
  return (
    <section className={`rounded-2xl p-3 shadow-lg ${URGENCY_STYLE[i.urgency].card}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-extrabold tracking-wider ${URGENCY_STYLE[i.urgency].pill}`}>{i.urgency}</span>
        <span className={`text-xs ${sub}`}>
          {i.category}
          {i.calls.length > 1 ? ` · ${i.calls.length} calls merged` : ""}
        </span>
      </div>
      <h2 className="mt-2 text-xl font-extrabold leading-tight">{i.summary}</h2>
      <p className={`mt-1 text-sm leading-snug ${dark ? "text-white" : "text-slate-800"}`}>
        <span className="font-bold">Do now:</span> {i.action}
      </p>
      <p className={`mt-2 border-t pt-2 text-xs italic ${dark ? "border-white/20" : "border-black/10"} ${sub}`}>
        &ldquo;{i.calls[i.calls.length - 1].text}&rdquo;
        {i.source === "ai" && <span className="ml-1 font-semibold not-italic text-violet-500">AI read</span>}
      </p>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        {responder ? (
          <button onClick={() => onSend(responder)} className="rounded-xl bg-emerald-500 py-2.5 text-sm font-extrabold text-white active:bg-emerald-600">
            Send {responder.firstName} · first aid · {responder.etaMin} min
          </button>
        ) : dark && (i.category === "Security" || i.category === "Fire / hazard") ? (
          // Police and fire are not volunteer work. One tap dials; nobody is sent to confront anyone.
          <a
            href="tel:000"
            onClick={() => onCall000?.()}
            className="flex items-center justify-center rounded-xl bg-red-500 py-2.5 text-sm font-extrabold text-white active:bg-red-600"
          >
            Call 000
          </a>
        ) : (
          <div className={`flex items-center rounded-xl px-3 text-xs ${dark ? "bg-white/10" : "bg-black/5"}`}>You decide. Nobody is moved until you tap.</div>
        )}
        <button onClick={onHandled} className={`rounded-xl border-2 px-3 py-2.5 text-xs font-semibold ${dark ? "border-white/40 bg-transparent text-white" : "border-slate-300 bg-white"}`}>
          Handled
        </button>
      </div>
    </section>
  );
}

/** One person's time in the sun as a bar that fills toward the radio-reminder limit. */
function SunRow({ row }: { row: ReturnType<typeof sunWatch>[number] }) {
  const v = row.volunteer;
  const pct = Math.min(100, (row.minutes / RELIEF_MIN) * 100);
  const bar = row.level === "relief" ? "bg-red-500" : row.level === "soon" ? "bg-orange-500" : "bg-emerald-500";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-semibold">
          {v.name} <span className="font-normal text-slate-500">· {v.satZone}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums">{fmtDuration(row.minutes)}</span>
      </div>
      {/* The bar fills toward the relief limit; the notch marks where Sharon's 1h 30m reminder goes out. */}
      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-slate-500/60" style={{ left: `${(REMIND_EVERY_MIN / RELIEF_MIN) * 100}%` }} />
      </div>
      {row.level === "soon" && v.status !== "heat_out" && <div className="mt-0.5 text-xs text-orange-700">Relief recommended in {row.minutesLeft} min</div>}
      {v.status === "heat_out" && <div className="mt-0.5 text-xs font-semibold text-red-700">Relief recommended · waiting for approval</div>}
    </li>
  );
}

function MoveCard({
  move: m,
  refill,
  swapOpen,
  onToggleSwap,
  onPick,
}: {
  move: Move;
  refill?: Move;
  swapOpen: boolean;
  onToggleSwap: () => void;
  onPick: (c: Candidate) => void;
}) {
  const chips = [...m.cautions, ...m.why].slice(0, 3);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold leading-tight">{m.name}</div>
          <div className="text-xs text-slate-600">
            {m.source === "onsite" ? `Posted at ${m.fromZone}` : "Idle at hub"} → <span className="font-semibold text-slate-900">{m.toZone}</span>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="text-xs font-semibold tabular-nums text-slate-900">{m.etaMin} min</div>
          {timeSpan(m)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className={`rounded-full px-2 py-0.5 text-xs ${m.cautions.includes(c) ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
            {c}
          </span>
        ))}
      </div>
      {refill && (
        <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
          Then <span className="font-semibold">{refill.name}</span> ({refill.source === "standby" ? "idle at hub" : refill.fromZone}, {refill.etaMin} min) refills {refill.toZone}
        </div>
      )}
      {m.alternates.length > 0 && (
        <button onClick={onToggleSwap} className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium">
          {swapOpen ? "Close" : "Swap person"}
        </button>
      )}
      {swapOpen && (
        <ul className="mt-2 space-y-1.5">
          {m.alternates.slice(0, 3).map((c) => (
            <li key={c.volunteerId}>
              <button onClick={() => onPick(c)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left active:bg-slate-50">
                <span>
                  <span className="block text-xs font-semibold">{c.name}</span>
                  <span className="block text-xs text-slate-500">
                    {c.source === "onsite" ? `Posted at ${c.fromZone}` : "Idle at hub"}
                    {c.cautions.length ? ` · ${c.cautions[0]}` : ""}
                  </span>
                </span>
                <span className="text-xs font-semibold tabular-nums">{c.etaMin} min</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
