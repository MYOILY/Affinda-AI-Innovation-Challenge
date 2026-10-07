# Crewline: Riverside Ground Control

A phone-first recovery tool for Mo, the Riverside safety lead. Messy reports in, one move out, Mo signs off. The AI assistant is called Sharon.

```bash
npm install
npm run dev -- -H 127.0.0.1     # http://127.0.0.1:3000, open it at phone width
cp .env.example .env.local      # optional keys, the demo works without them
```

## What is in it

| Part | What it does | Where |
| --- | --- | --- |
| Radio intake | Typed, spoken or recorded walkie audio becomes text (ElevenLabs), then is read twice: for roster changes and as an incident | `app/api/transcribe`, `app/api/report`, `app/api/incident` |
| Incident handling | Urgency, place, "do now" action. Duplicate calls merge. Medical calls offer the nearest idle first-aider | `lib/incident.ts` |
| Roster recovery | When someone is missing 10 minutes, a CSP search over people already on site proposes who to send and why | `lib/roster.ts`, `lib/csp.ts`, `lib/clock.ts` |
| Heat-Aware Monitor | Sun time per volunteer (`sun_min`); every 1h 30m in the sun Sharon sends an automatic radio reminder to their earpiece (drink water, find shade); at 2h 30m she recommends a relief for approval | `lib/heat.ts`, `app/api/radio` |

Sharon is the AI assistant. Every safety decision stays with Mo, the human safety lead: nothing is messaged or moved until she taps.

## Demo order (about 3 minutes)

The demo bar has five chips. Use them in this order.

1. **Radio: heat exhaustion**. A real recorded walkie call (`public/radio/`) plays out loud and is transcribed live (needs `ELEVENLABS_API_KEY`; without one the saved transcript in `lib/radio-calls.ts` is used and the strip says so). It becomes a HIGH medical incident. Tap *Send Vivian*.
2. **Radio: intruder at fence**. CRITICAL security incident: *Call 000*, and nobody is sent to confront them.
3. **Heat check**. Time runs fast. Marcus has 1h 28m in the sun, so at 2:07pm he gets an automatic radio reminder at exactly 1h 30m (the clock keeps running). At 2:10pm Sharon notices two no-shows and drafts a plan without Vivian: tap *Approve*. Press *Heat check* again: at 3:07pm Marcus reaches 2h 30m, Sharon recommends a relief and drafts a replacement. Tap *Approve* and he is released by radio.
4. **Medical: two haven't shown**. The same no-show plan, started from a typed or spoken report instead of the clock.
5. **Gate A: crowd pushing**. A HIGH crowd incident.

## Checks

```bash
npx tsc --noEmit
for s in check-csp check-engine check-report check-heat check-incident; do npx tsx scripts/$s.ts; done
```

`data/*.csv` is synthetic (`npm run data`). Regenerating keeps the hand-edited `sun_min` column.
