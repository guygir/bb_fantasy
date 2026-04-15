import { NextResponse } from "next/server";
import { getCurrentPuzzleDate, loadDailyDataWithSource } from "@/lib/u21dle/daily";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Returns the current puzzle date (most recent ≤ today).
 * Same as Holdemle/Riftle: UTC today, Supabase query with .lte().order().limit(1), service role.
 */
export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0];
    console.log("[u21dle daily API] GET", { today, iso: new Date().toISOString() });

    const supabase = getSupabaseAdmin();
    const date = await getCurrentPuzzleDate(supabase);
    console.log("[u21dle daily API] getCurrentPuzzleDate returned", { date });

    if (!date) {
      console.log("[u21dle daily API] 404 - no puzzle for today");
      const { data, source, supabaseError } = await loadDailyDataWithSource();
      return NextResponse.json(
        {
          success: false,
          error: "No puzzle available yet. Today's puzzle is coming up shortly!",
          data: null,
          _debug: {
            source,
            today,
            availableDates: Object.keys(data).sort(),
            supabaseError,
          },
        },
        { status: 404 }
      );
    }
    console.log("[u21dle daily API] success", { today, date });
    return NextResponse.json({
      success: true,
      data: { date },
      _debug: { today, date },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
