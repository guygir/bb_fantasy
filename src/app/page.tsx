"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { config } from "@/lib/config";
import { supabase } from "@/lib/supabase-client";

const CAP = config.game.cap;

export default function HomePage() {
  const [hasRoster, setHasRoster] = useState<boolean | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setHasRoster(false);
      return;
    }
    void client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) {
        setHasRoster(false);
        return;
      }
      try {
        const { data } = await client
          .from("fantasy_user_rosters")
          .select("player_ids")
          .eq("user_id", session.user.id)
          .eq("season", config.game.currentSeason)
          .maybeSingle();
        setHasRoster(!!data?.player_ids?.length);
      } catch {
        setHasRoster(false);
      }
    });
  }, []);

  return (
    <main className="flex flex-col items-center min-h-full">
      <div className="max-w-md lg:max-w-xl w-full text-center space-y-6 sm:space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-4xl font-bold text-bb-text">
            BB Israel U21 Fantasy
          </h1>
          <p className="text-base sm:text-lg text-gray-600">
            Pick 5 players within a ${CAP} cap.
            <br />
            Earn fantasy points from their U21 game stats.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href={hasRoster ? "/roster" : "/pick"}
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-exact text-white font-semibold rounded-lg hover:bg-[#5a9a54] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            {hasRoster ? "My Roster" : "Pick Your Team"}
          </Link>
          <Link
            href="/players"
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-low text-white font-semibold rounded-lg hover:bg-[#75b0e9] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            Players (Season {config.game.currentSeason})
          </Link>
          <Link
            href="/leaderboard"
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-bb-gold text-bb-text font-semibold rounded-lg border border-[#B8962E] hover:bg-[#C9A227] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            Leaderboard
          </Link>
          <Link
            href="/u21dle"
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-[#6366f1] text-white font-semibold rounded-lg hover:bg-[#4f46e5] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            U21dle – Daily Puzzle
          </Link>
          <Link
            href="/schedule"
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-[#64748b] text-white font-semibold rounded-lg hover:bg-[#475569] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            Schedule
          </Link>
          <Link
            href="/help"
            className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-card-bg text-bb-text font-semibold rounded-lg border border-bb-border hover:bg-[#e8e9eb] transition-colors flex items-center justify-center text-sm sm:text-base"
          >
            How to Play
          </Link>
        </div>

        <p className="text-sm text-gray-500 pt-4 border-t border-bb-border">
          Roster saved when signed in.
        </p>
      </div>
    </main>
  );
}
