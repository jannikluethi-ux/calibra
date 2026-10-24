import { NextResponse } from "next/server";
import { createUser } from "@/lib/auth/users";
import { createSession, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = createUser(String(body.email || ""), String(body.password || ""), "free");
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
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Signup failed" },
      { status: 400 }
    );
  }
}
