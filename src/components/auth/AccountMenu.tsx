"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Me {
  user: { email: string; plan: string } | null;
}

export function AccountMenu({ variant = "status" }: { variant?: "status" | "sidebar" }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ user: null }));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (!me) {
    return <span className="text-terminal-muted text-2xs">…</span>;
  }

  if (!me.user) {
    return (
      <div className={variant === "sidebar" ? "flex flex-col gap-1" : "flex items-center gap-2"}>
        <Link href="/login" className="text-terminal-teal hover:underline text-2xs">
          Log in
        </Link>
        <Link href="/pricing" className="text-terminal-dim hover:text-terminal-text text-2xs">
          Pricing
        </Link>
      </div>
    );
  }

  return (
    <div className={variant === "sidebar" ? "flex flex-col gap-1 text-2xs" : "flex items-center gap-2 text-2xs"}>
      <Link href="/account" className="text-terminal-text hover:text-terminal-teal truncate max-w-[140px]">
        {me.user.email}
      </Link>
      <span className="uppercase tracking-wider text-terminal-teal/80 border border-terminal-teal/30 rounded px-1">
        {me.user.plan}
      </span>
      {variant === "sidebar" && (
        <>
          <Link href="/account/api-keys" className="text-terminal-dim hover:text-terminal-text">
            API keys
          </Link>
          <Link href="/pricing" className="text-terminal-dim hover:text-terminal-text">
            Plans
          </Link>
        </>
      )}
      <button onClick={logout} className="text-terminal-muted hover:text-terminal-red text-left">
        Log out
      </button>
    </div>
  );
}
