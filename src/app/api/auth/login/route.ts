import { NextResponse } from "next/server";
import { authenticateUser, ensureDemoUsers } from "@/lib/auth/users";
import { createSession, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  ensureDemoUsers();
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "");
  const password = String(body.password || "");
  const user = authenticateUser(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const token = createSession(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email, plan: user.plan } });
  const opts = sessionCookieOptions(token);
  res.cookies.set(opts.name, opts.value, {
    httpOnly: opts.httpOnly,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
    secure: opts.secure,
  });
  return res;
}
