import { NextResponse } from "next/server";
import { CATEGORIES, classifyRules, Classification, mergeAi, URGENCIES } from "@/lib/incident";

export const runtime = "nodejs";

/**
 * Reads one radio call into a structured incident (urgency, category, place, summary, action).
 * Rules always run first. With OPENAI_API_KEY a model may improve the wording and the place, but
 * mergeAi() guarantees it can never rate a call lower than the rules did.
 */
export async function POST(req: Request) {
  const { text, zones } = (await req.json()) as { text: string; zones: string[] };
  const rules = classifyRules(text ?? "");
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text?.trim()) return NextResponse.json(rules);

  const system = [
    "You triage short, noisy radio calls at a busy Melbourne summer festival for the safety lead.",
    `Return JSON {"urgency": one of ${URGENCIES.join("|")}, "category": one of ${CATEGORIES.join("|")}, "zone": one of the given zones or null, "summary": string max 12 words, "action": string max 20 words}.`,
    "CRITICAL = threat to life (unconscious, not breathing, fire, weapon, crush). HIGH = needs a response within minutes. MEDIUM = needs attention soon. LOW = log only.",
    "action says what the safety lead should do next, in plain words, and names the place. Never invent facts that are not in the call.",
  ].join(" ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ call: text, zones }) },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json(rules);
    const data = await res.json();
    const ai = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Partial<Classification>;
    return NextResponse.json(mergeAi(rules, ai, zones ?? []));
  } catch {
    return NextResponse.json(rules);
  }
}
