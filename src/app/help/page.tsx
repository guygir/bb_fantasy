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
          <li><Link href="/roster" className="text-exact hover:underline font-medium">My Roster</Link> – View your picks and total fantasy points</li>
          <li><Link href="/players" className="text-exact hover:underline font-medium">Players</Link> – Browse players with prices and stats</li>
          <li><Link href="/leaderboard" className="text-exact hover:underline font-medium">Leaderboard</Link> – Top fantasy scorers</li>
        </ul>
        <p className="text-sm text-gray-500">
          Player prices ($1–$10) are adjusted weekly based on performance. Your roster is saved in this browser until you sign in.
        </p>
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
