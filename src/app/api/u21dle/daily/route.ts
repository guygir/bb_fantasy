import { NextResponse } from "next/server";
import { getCurrentPuzzleDate } from "@/lib/u21dle/daily";

export const dynamic = "force-dynamic";

/**
 * Returns the current puzzle date (most recent ≤ today).
 * Does NOT return the answer - client gets feedback via POST /api/u21dle/guess.
 */
export async function GET() {
  try {
    const date = getCurrentPuzzleDate();
    if (!date) {
      return NextResponse.json(
        {
          success: false,
          error: "No puzzle available yet. Today's puzzle is coming up shortly!",
          data: null,
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      data: { date },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
