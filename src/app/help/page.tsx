import Link from "next/link";

export const metadata = {
  title: "Help – Israel U21 Fantasy",
  description: "Rules and how to play Israel U21 Fantasy and U21dle",
};

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Help</h1>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Israel U21 Fantasy</h2>
        <p className="mb-2 text-gray-600">
          Pick 5 players from the Israel U21 national team within a $30 salary cap. Earn fantasy points from their real-game stats (points, rebounds, assists, steals, blocks, etc.).
        </p>
        <ul className="mb-2 list-inside list-disc space-y-1 text-gray-600">
          <li><Link href="/pick" className="text-exact hover:underline font-medium">Pick Team</Link> – Select your 5 players</li>
          <li><Link href="/roster" className="text-exact hover:underline font-medium">My Roster</Link> – View your picks, Last week FP, and make substitutions</li>
          <li><Link href="/players" className="text-exact hover:underline font-medium">Players</Link> – Browse players with $ (Fantasy), Last game FP, Total FP</li>
          <li><Link href="/leaderboard" className="text-exact hover:underline font-medium">Leaderboard</Link> – Top fantasy scorers (Total FP, Last game FP)</li>
        </ul>
        <p className="mb-2 text-sm text-gray-500">
          <strong>Last game FP</strong> = fantasy points in the most recent match played (0 if DNP). Same definition on Players, Roster, and Leaderboard. Substitutions open 1h after the previous game until 1h before the next game.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Scoring (Fantasy Points Formula)</h2>
        <p className="mb-2 text-gray-600">
          Fantasy points per game:
        </p>
        <pre className="mb-2 overflow-x-auto rounded-lg bg-gray-100 p-4 text-sm">
{`PTS×1.0 + DR×1.2 + OR×1.5 + AST×1.8 + STL×2.0 + BLK×2.0 - TO×1.0 - PF×1.0 + 3PM×0.5`}
        </pre>
        <p className="mb-2 text-sm text-gray-500">
          DR = TR − OR (defensive rebounds). 3PM = three-pointers made.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Price Tiers ($1–$10)</h2>
        <p className="mb-2 text-gray-600">
          PPG (fantasy points per game) maps to price:
        </p>
        <ul className="mb-2 list-inside list-disc space-y-0.5 text-sm text-gray-600">
          <li>≥27 PPG → $10</li>
          <li>≥24 → $9 · ≥21 → $8 · ≥18 → $7 · ≥15 → $6</li>
          <li>≥12 → $5 · ≥9 → $4 · ≥6 → $3 · ≥3 → $2</li>
          <li>&lt;3 → $1</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Price Adjustment Rules</h2>
        <ul className="mb-2 list-inside list-disc space-y-1 text-gray-600">
          <li><strong>Min games:</strong> 2 games before any price adjustment (avoids noise from single-game spikes)</li>
          <li><strong>Weighted PPG:</strong> Recent games count more (30% last, 20% before, 10%, 5%, 2.5%…), scaled to 100%. DNPs count as 0 FP. Target price from tiers.</li>
          <li><strong>Confidence:</strong> 1–3 games → max ±$1 per game; 4+ games → max ±$2 per game</li>
          <li><strong>DNP (did not play):</strong> $9–10 → −$2; $3–8 → −$1; $1–2 → no change. Performance vs DNP are mutually exclusive per game.</li>
          <li><strong>Roster:</strong> Prices use current market value. If your roster exceeds $30, you must sub or the system auto-subs (highest→cheapest) before the next game.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">U21dle</h2>
        <p className="mb-2 text-gray-600">
          Daily puzzle: guess the Israel U21 player in 6 tries. Each guess shows feedback on GP, PTS, Age, Height, Potential, and Trophies.
        </p>
        <p className="mb-2">
          <Link href="/u21dle" className="text-exact hover:underline font-medium">Play U21dle →</Link>
          {" · "}
          <Link href="/u21dle/help" className="text-exact hover:underline font-medium">Full U21dle rules →</Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Data & Updates</h2>
        <p className="text-gray-600">
          Schedule and boxscores come from BBAPI. Run <code className="rounded bg-gray-100 px-1">npm run fetch-schedule</code> and{" "}
          <code className="rounded bg-gray-100 px-1">npm run process-boxscores</code> to refresh data. Prices update via{" "}
          <code className="rounded bg-gray-100 px-1">npm run update-prices</code>.
        </p>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Account</h2>
        <p className="text-gray-600">
          U21dle and Israel U21 Fantasy will use the same account when you sign in. Your picks, stats, and leaderboard position will be saved.
        </p>
      </section>
    </div>
  );
}
