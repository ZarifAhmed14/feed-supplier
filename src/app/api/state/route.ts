import { clearAppState, readAppState, writeAppState } from "@/lib/server-state";

export const runtime = "nodejs";

export async function GET() {
  const value = readAppState();
  return Response.json(value ? JSON.parse(value) : null, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const text = await request.text();
  if (text.length > 1_000_000) return Response.json({ error: "State exceeds 1 MB limit." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  writeAppState(body);
  return Response.json({ ok: true });
}

export async function DELETE() {
  clearAppState();
  return Response.json({ ok: true });
}
