import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { brand } from "@/lib/brand";

const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${brand.name} — Probabilistic market intelligence`,
  description: brand.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ui.variable}>
      <body className={ui.className} style={{ ["--font-display" as string]: "var(--font-ui)" }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
