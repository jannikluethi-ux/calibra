import { NextResponse } from "next/server";
import { getCountries, getCountry } from "@/lib/countries/profiles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (code) return NextResponse.json({ country: getCountry(code) });
  return NextResponse.json({ countries: getCountries() });
}
