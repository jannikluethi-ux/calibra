import { NextResponse } from "next/server";
import { getPortfolio, savePortfolio, analyzePortfolioImpact } from "@/lib/portfolio/impact";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  const holdings = getPortfolio();
  return NextResponse.json({ holdings, impact: analyzePortfolioImpact(holdings) });
}

export async function POST(req: Request) {
  ensureSeedData();
  const body = await req.json();
  const saved = savePortfolio(Array.isArray(body.holdings) ? body.holdings : []);
  return NextResponse.json({
    holdings: saved.holdings,
    resolutions: saved.resolutions,
    impact: analyzePortfolioImpact(saved.holdings),
  });
}
