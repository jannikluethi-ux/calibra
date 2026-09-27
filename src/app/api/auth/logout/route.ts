import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, destroySession, clearSessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  const opts = clearSessionCookieOptions();
  res.cookies.set(opts.name, opts.value, {
    httpOnly: opts.httpOnly,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
  });
  return res;
}
