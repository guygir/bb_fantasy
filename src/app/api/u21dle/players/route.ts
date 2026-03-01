import { NextResponse } from "next/server";
import { searchU21dlePlayers } from "@/lib/u21dle/players";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  try {
    const players = searchU21dlePlayers(q, 10);
    return NextResponse.json({ players });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
