import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/analyst/reason";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question : "";
  const result = answerQuestion(question);
  return NextResponse.json(result);
}
