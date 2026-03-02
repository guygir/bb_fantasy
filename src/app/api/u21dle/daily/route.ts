import { NextResponse } from "next/server";
import { loadDailyDataWithSource, getTodayIsrael } from "@/lib/u21dle/daily";

export const dynamic = "force-dynamic";

/**
 * Returns the current puzzle date (most recent ≤ today).
 * Uses Israel timezone so localhost and Vercel match.
 * Includes _debug with source (supabase|json), today, and available dates for troubleshooting.
 */
export async function GET() {
  try {
    const today = getTodayIsrael();
    const { data, source, supabaseError } = await loadDailyDataWithSource();
    const dates = Object.keys(data).filter((d) => d <= today).sort();
    const date = dates.length > 0 ? dates[dates.length - 1] ?? null : null;

    if (!date) {
      return NextResponse.json(
        {
          success: false,
          error: "No puzzle available yet. Today's puzzle is coming up shortly!",
          data: null,
          _debug: { source, today, availableDates: Object.keys(data).sort(), supabaseError },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      data: { date },
      _debug: { source, today, availableDates: Object.keys(data).sort(), supabaseError },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
