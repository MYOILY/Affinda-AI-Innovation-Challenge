import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Walkie-talkie audio in, text out, using ElevenLabs speech-to-text. The key lives in
 * ELEVENLABS_API_KEY on the server, never in the browser. Without a key the UI says so and the
 * demo carries on with typed or spoken reports.
 */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 501 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "too_big" }, { status: 413 });

  const body = new FormData();
  body.append("file", file);
  body.append("model_id", "scribe_v1");

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return NextResponse.json({ error: "stt_failed", status: res.status }, { status: 502 });
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return NextResponse.json(text ? { text } : { error: "unintelligible" }, { status: text ? 200 : 422 });
  } catch {
    return NextResponse.json({ error: "stt_failed" }, { status: 502 });
  }
}
