import { NextResponse } from "next/server";
import { cancelJob, getJob, toView } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const job = getJob(params.id);
  if (!job) return NextResponse.json({ error: "Job not found. It may have expired." }, { status: 404 });
  return NextResponse.json(toView(job), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = cancelJob(params.id);
  if (!ok) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
