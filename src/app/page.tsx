"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { config } from "@/lib/config";
import { supabase } from "@/lib/supabase-client";
import { SuggestFeature } from "@/components/SuggestFeature";

const CAP = config.game.cap;

export default function HomePage() {
  const [hasRoster, setHasRoster] = useState<boolean | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setHasRoster(false);
      return;
    }
    const cacheKey = `hasRoster_${config.game.currentSeason}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached === "true" || cached === "false") {
        setHasRoster(cached === "true");
      }
    } catch {}
    void client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) {
        setHasRoster(false);
        try {
          sessionStorage.removeItem(cacheKey);
        } catch {}
        return;
      }
      try {
        const { data } = await client
          .from("fantasy_user_rosters")
          .select("player_ids")
          .eq("user_id", session.user.id)
          .eq("season", config.game.currentSeason)
          .maybeSingle();
        const has = !!data?.player_ids?.length;
        setHasRoster(has);
        try {
          sessionStorage.setItem(cacheKey, String(has));
        } catch {}
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
          {/* Standard button size: min-h-[44px] py-3 */}
          <div className="flex flex-col gap-3">
            <Link
              href="/players"
              className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-peach text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
            >
              Players (Season {config.game.currentSeason})
            </Link>
            {hasRoster === null ? (
              <div className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-gray-200 text-gray-500 font-semibold rounded-xl flex items-center justify-center text-sm sm:text-base">
                Loading…
              </div>
            ) : (
              <Link
                href={hasRoster ? "/roster" : "/pick"}
                className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-cream text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
              >
                {hasRoster ? "My Roster" : "Pick Your Team"}
              </Link>
            )}
            <Link
              href="/schedule"
              className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-mint text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
            >
              Schedule
            </Link>
            <Link
              href="/leaderboard"
              className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-sky-pastel text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
            >
              Leaderboard
            </Link>
            <Link
              href="/help"
              className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-gray-pastel text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
            >
              How to Play
            </Link>
          </div>

          <hr className="border-bb-border my-4" />

          <Link
            href="/u21dle"
            className="block w-full min-h-[80px] py-6 px-6 sm:px-8 bg-btn-lavender text-bb-text font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-xl sm:text-2xl shadow-lg"
          >
            U21dle – Daily Puzzle
          </Link>

          <hr className="border-bb-border my-4" />

          {config.githubRepo && (
            <SuggestFeature
              className="block w-full min-h-[44px] py-3 px-4 sm:px-6 bg-btn-teal-pastel text-bb-text font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center text-sm sm:text-base"
            />
          )}
        </div>
      </div>
    </main>
  );
}
