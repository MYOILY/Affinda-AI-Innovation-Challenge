import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface InMove {
  volunteerId: string;
  name: string;
  kind: "cover" | "backfill";
  source: "standby" | "onsite";
  fromZone: string;
  toZone: string;
  role: string;
  when: string;
  until: string;
  etaMin: number;
  why: string[];
  cautions: string[];
  draft: string;
}

/**
 * The planner has already chosen WHO (hard constraints + ranking happen in lib/roster.ts).
 * The model's job is wording: a one-line "why" for Mo and short, friendly texts for volunteers.
 * It cannot add, remove or swap people; unknown ids are discarded.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { moves: InMove[]; context: string };
  const key = process.env.OPENAI_API_KEY;
  if (!key || !body.moves?.length) return NextResponse.json({ source: "template" });

  const system = [
    "You are Mina, the AI assistant who helps Mo, the safety lead at a Melbourne summer festival, act fast on a hot day.",
    "Texts to volunteers come from you: they open with 'Hi <first name>, this is Mina from Riverside Ops.'",
    "You are given a roster recovery plan that has ALREADY been decided. Do not change who goes where.",
    "Return JSON: {\"summary\": string, \"messages\": {\"<volunteerId>\": string}}.",
    "summary: max 22 words, plain, says what Mo is approving and why it is the right trade-off.",
    "messages: one SMS per volunteer, max 160 characters, friendly, student-level language, no jargon, no emojis.",
    "Each message must state the place, when, how far, and end with 'Reply Y/N'. Never invent facts.",
  ].join(" ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(body) },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ source: "template" });
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { summary?: string; messages?: Record<string, string> };

    const allowed = new Set(body.moves.map((m) => m.volunteerId));
    const messages: Record<string, string> = {};
    for (const [id, text] of Object.entries(parsed.messages ?? {})) {
      if (allowed.has(id) && typeof text === "string" && text.length > 0 && text.length <= 220) messages[id] = text.trim();
    }
    const summary = typeof parsed.summary === "string" && parsed.summary.length <= 200 ? parsed.summary.trim() : undefined;
    return NextResponse.json({ source: "ai", summary, messages });
  } catch {
    return NextResponse.json({ source: "template" });
  }
}
