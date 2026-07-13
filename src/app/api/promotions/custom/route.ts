import { NextResponse } from "next/server";
import { generateCustomPromotions, parsePromotionLevel } from "@/lib/promotions-on-demand";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = Number(searchParams.get("countryId"));
  const level = parsePromotionLevel(searchParams.get("level"));

  if (!Number.isInteger(countryId) || countryId < 1 || countryId > 99) {
    return NextResponse.json({ error: "countryId must be an integer between 1 and 99" }, { status: 400 });
  }

  if (!level) {
    return NextResponse.json({ error: "level must be one of II, III, IV, V" }, { status: 400 });
  }

  try {
    const result = await generateCustomPromotions(countryId, level);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
