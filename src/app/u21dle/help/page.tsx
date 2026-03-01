import Link from "next/link";

export const metadata = {
  title: "U21dle – How to Play",
  description: "Rules and tips for U21dle, the Israel U21 player guessing game",
};

export default function U21dleHelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/u21dle" className="text-sm text-exact hover:underline font-medium">
          ← Back to U21dle
        </Link>
      </div>

      <h1 className="mb-4 text-2xl font-bold">How to Play U21dle</h1>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Objective</h2>
        <p className="text-gray-600">
          Guess the Israel U21 player in 6 tries. Each guess reveals feedback on 6 stats: GP, PTS, Age, Height, Potential, and Trophies.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Eligible Players</h2>
        <p className="text-gray-600">
          All players are from Israel U21 national team stats (seasons 60–70 on BuzzerBeater) with at least 8 games played.
        </p>
        <p className="mt-2">
          <Link href="/u21dle/players" className="text-exact hover:underline font-medium">
            View all eligible players →
          </Link>
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Feedback</h2>
        <p className="mb-2 text-gray-600">Each stat gets one of three feedback types:</p>
        <ul className="list-inside list-disc space-y-1 text-gray-600">
          <li><strong className="text-green-600">Exact</strong> – your guess matches the answer</li>
          <li><strong className="text-orange-600">Too high</strong> – your guess is higher; the answer is lower</li>
          <li><strong className="text-blue-600">Too low</strong> – your guess is lower; the answer is higher</li>
        </ul>
        <p className="mt-2 text-sm text-gray-500">
          PTS uses one decimal place. Height is in cm. Trophies = 0–3 (U21 EuroBasket).
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Daily Puzzle</h2>
        <p className="text-gray-600">
          One puzzle per day. If today&apos;s puzzle isn&apos;t ready yet, you&apos;ll see yesterday&apos;s. Your progress is saved in this browser.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Share</h2>
        <p className="text-gray-600">
          After finishing, use &quot;Share Results&quot; to copy an emoji grid to your clipboard. Green = exact, orange = too high, blue = too low.
        </p>
      </section>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          U21dle uses the same account as Israel U21 Fantasy. When you sign in, your stats and leaderboard position will be saved.
        </p>
      </div>
    </div>
  );
}
