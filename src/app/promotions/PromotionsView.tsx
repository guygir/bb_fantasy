import Link from "next/link";
import { getNextPromotionsScheduledRunUtc } from "@/lib/promotions-schedule";
import type {
  FinalsInfo,
  LatestRankChange,
  PlayoffStatus,
  PromotionEntry,
  PromotionNewsBlock,
} from "@/lib/promotions";
import type { PromotionTierConfig, PromotionTierId } from "@/lib/promotions-tier";

function formatSnapshot(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function LatestChangeCell({ change }: { change: LatestRankChange }) {
  if (change.kind === "none") {
    return (
      <span className="text-gray-400" title="No previous snapshot or team was outside the ranked list last time">
        —
      </span>
    );
  }
  if (change.kind === "same") {
    return (
      <span className="text-gray-700" aria-label="Same overall rank as previous update">
        Same rank
      </span>
    );
  }
  if (change.kind === "up") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <span className="text-gray-700">Moved:</span>
        <span
          className="inline-flex items-center gap-0.5 font-medium tabular-nums text-green-600"
          aria-label={`Moved up ${change.magnitude} places in overall rank`}
        >
          <span aria-hidden>↑</span>
          {change.magnitude}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="text-gray-700">Moved:</span>
      <span
        className="inline-flex items-center gap-0.5 font-medium tabular-nums text-red-600"
        aria-label={`Moved down ${change.magnitude} places in overall rank`}
      >
        <span aria-hidden>↓</span>
        {change.magnitude}
      </span>
    </span>
  );
}

function isPlayoffOutStatus(s: PlayoffStatus): boolean {
  return (
    s === "Lost Quarters" ||
    s === "Lost Semis" ||
    s === "Lost Finals" ||
    s === "Not in playoff"
  );
}

/** Get team ID from team_url like "https://buzzerbeater.com/team/38135/overview.aspx" */
function parseTeamIdFromUrl(url: string | null): number | null {
  if (!url) return null;
  const match = url.match(/\/team\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Green = first `bandSize` rows that are not champion (yellow). Champs skip the green quota.
 * Striped-green = "to-be-promoted" band: teams that will enter the band when two teams
 * from the same league in the current band are playing each other in the finals
 * (one will become champ, freeing a green slot).
 */
function buildRowStyles(
  entries: PromotionEntry[],
  bandSize: number,
  finalsByLeague: Record<string, FinalsInfo> | null
): { row: PromotionEntry; className: string }[] {
  // First pass: assign yellow (champ), green (band), white (outside)
  let greenLeft = bandSize;
  const styles: ("yellow" | "green" | "white")[] = [];
  
  for (const row of entries) {
    if (row.playoff_status === "Champ") {
      styles.push("yellow");
    } else if (greenLeft > 0) {
      greenLeft -= 1;
      styles.push("green");
    } else {
      styles.push("white");
    }
  }
  
  // Second pass: find "to-be-promoted" slots (striped green)
  // Look for pairs of teams in the green band that are in the same league AND in finals against each other
  if (finalsByLeague) {
    let extraSlots = 0;
    
    // Group green-band teams by league
    const greenTeamsByLeague = new Map<number, number[]>(); // league_id -> indices
    for (let i = 0; i < entries.length; i++) {
      if (styles[i] === "green") {
        const leagueId = entries[i].league_id;
        if (!greenTeamsByLeague.has(leagueId)) {
          greenTeamsByLeague.set(leagueId, []);
        }
        greenTeamsByLeague.get(leagueId)!.push(i);
      }
    }
    
    // Check each league with 2+ green teams
    for (const [leagueId, indices] of greenTeamsByLeague) {
      if (indices.length < 2) continue;
      
      const fi = finalsByLeague[String(leagueId)];
      if (!fi || fi.leftTeamId == null || fi.rightTeamId == null) continue;
      
      // Check if both finalists are in the green band for this league
      const finalistIds = new Set([fi.leftTeamId, fi.rightTeamId]);
      const greenFinalists = indices.filter(i => {
        const teamId = parseTeamIdFromUrl(entries[i].team_url);
        return teamId != null && finalistIds.has(teamId);
      });
      
      // If both finalists are in the green band, one will become champ → free slot
      if (greenFinalists.length === 2) {
        extraSlots++;
      }
    }
    
    // Assign striped-green to next `extraSlots` white rows
    if (extraSlots > 0) {
      for (let i = 0; i < entries.length && extraSlots > 0; i++) {
        if (styles[i] === "white") {
          styles[i] = "striped" as "white"; // We'll handle this in the output
          extraSlots--;
        }
      }
    }
  }
  
  // Build output with CSS classes
  const out: { row: PromotionEntry; className: string }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const style = styles[i];
    let className: string;
    if (style === "yellow") {
      className = "bg-yellow-100 hover:bg-yellow-200/90";
    } else if (style === "green") {
      className = "bg-green-50 hover:bg-green-100/90";
    } else if (style === ("striped" as "white")) {
      className = "bg-striped-green hover:bg-green-100/90";
    } else {
      className = "hover:bg-gray-50/80";
    }
    out.push({ row: entries[i], className });
  }
  
  return out;
}

type PromotionsViewProps = {
  tierId: PromotionTierId;
  tier: PromotionTierConfig;
  snapshotAt: string | null;
  previousSnapshotAt: string | null;
  entries: PromotionEntry[];
  error: string | null;
  promotionBandSize: number;
  numBotLeagues: number | null;
  /** League III: headline digest vs previous snapshot */
  promotionNews?: PromotionNewsBlock | null;
  /** League III: finals series per league (best of 3). Key = league_id string. */
  finalsByLeague?: Record<string, FinalsInfo> | null;
};

export function PromotionsView({
  tierId,
  tier,
  snapshotAt,
  previousSnapshotAt,
  entries,
  error,
  promotionBandSize,
  numBotLeagues,
  promotionNews = null,
  finalsByLeague = null,
}: PromotionsViewProps) {
  const nextScheduledAt = formatSnapshot(getNextPromotionsScheduledRunUtc().toISOString());
  const band = promotionBandSize;
  const styledRows = entries.length > 0 ? buildRowStyles(entries, band, finalsByLeague) : [];

  return (
    <div className="text-sm text-gray-600">
      <h2 className="mb-3 text-lg font-semibold text-bb-text sm:text-xl">{tier.pageTitle}</h2>
      <div className="mb-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1 max-w-3xl">
          <p className="mb-1 font-medium text-bb-text">Ranking</p>
          <ol className="ml-5 list-decimal space-y-0.5">
            <li>{tier.botRuleLine}</li>
            <li>Conference rank (all 1st-place finishes before 2nd, before 3rd).</li>
            <li>Wins — higher is better.</li>
            <li>Point differential — higher is better.</li>
          </ol>
          {tierId === "league3" && numBotLeagues != null && (
            <p className="mt-3 text-gray-500">
              Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span>. League II has 5
              demotion slots per league × 4 leagues = <strong className="text-bb-text">20</strong> demotions, so 20
              promotion slots from League III. A League III division is a{" "}
              <strong className="text-bb-text">bot league</strong> if all 16 teams are CPU (standings{" "}
              <code className="rounded bg-gray-100 px-1">isbot</code>). Promotion band size ={" "}
              <strong className="font-mono text-bb-text">20 − (16 − bot leagues)</strong> → with{" "}
              <strong className="text-bb-text">{numBotLeagues}</strong> bot league{numBotLeagues === 1 ? "" : "s"}:{" "}
              <strong className="text-bb-text">{band}</strong> rows. Rows are highlighted{" "}
              <strong className="text-bb-text">green</strong> in rank order until that many non-champion slots are
            filled; when two green-band teams from the same league face each other in the finals, one will become
            champion (freeing a slot), so the next team in line is shown in{" "}
            <strong className="text-bb-text">striped green</strong> (to-be-promoted);{" "}
            <strong className="text-bb-text">Champ</strong> uses yellow and does not consume a green slot;{" "}
            <strong className="text-bb-text">In Quarters</strong> / <strong className="text-bb-text">In Semis</strong> /{" "}
            <strong className="text-bb-text">In Finals</strong> / <strong className="text-bb-text">Champ</strong> /{" "}
            <span className="text-red-600" aria-hidden>
              ❌
            </span>{" "}
            <strong className="text-bb-text">Lost Quarters</strong> / <strong className="text-bb-text">Lost Semis</strong> /{" "}
            <strong className="text-bb-text">Lost Finals</strong> / <strong className="text-bb-text">Not in playoff</strong>{" "}
            <span className="text-red-600" aria-hidden>
              ❌
            </span>{" "}
            describe the playoff bracket (see Playoff column).
            </p>
          )}
          {tierId === "league2" && (
            <p className="mt-3 text-gray-500">
              Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span> · First{" "}
              <span className="font-medium text-bb-text">{band}</span> non-champion rows (green) are the promotion
              band; champions (yellow) skip the green count.
            </p>
          )}
          {tierId === "league3" && numBotLeagues == null && (
            <p className="mt-3 text-gray-500">
              Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span> · Run{" "}
              <code className="rounded bg-gray-100 px-1">npm run fetch-promotions</code> after migration{" "}
              <code className="rounded bg-gray-100 px-1">027</code> so the snapshot stores bot-league counts (formula{" "}
              <span className="font-mono">20 − (16 − bot leagues)</span>). Until then, green rows use the fallback band
              size <strong className="text-bb-text">{band}</strong> when present.
            </p>
          )}
        </div>

        {tierId === "league3" && promotionNews && (
          <aside className="w-full shrink-0 lg:max-w-sm lg:pt-0">
            <div className="rounded-lg border border-bb-border bg-card-bg px-4 py-3 shadow-sm">
              <p className="mb-2 font-semibold text-bb-text">Snapshot news</p>
              <p className="mb-3 text-xs leading-relaxed text-gray-500">
                <span className="font-medium text-gray-600">Last update:</span>{" "}
                {formatSnapshot(promotionNews.snapshotAt)}
                {promotionNews.previousSnapshotAt != null && (
                  <>
                    {" "}
                    · <span className="font-medium text-gray-600">Compared to:</span>{" "}
                    {formatSnapshot(promotionNews.previousSnapshotAt)}
                  </>
                )}
              </p>
              {!promotionNews.hasCompare && (
                <p className="text-sm text-gray-600">First snapshot — nothing to compare yet.</p>
              )}
              {promotionNews.hasCompare && promotionNews.bullets.length === 0 && (
                <p className="text-sm text-gray-600">No headline changes since the last snapshot.</p>
              )}
              {promotionNews.bullets.length > 0 && (
                <ul className="space-y-1.5 text-sm text-gray-700">
                  {promotionNews.bullets.map((b, i) => {
                    let bgClass = "";
                    if (b.type === "champ") {
                      bgClass = "bg-yellow-100 border-l-4 border-yellow-400";
                    } else if (b.type === "entered_band") {
                      bgClass = "bg-green-100 border-l-4 border-green-400";
                    } else if (b.type === "left_band") {
                      bgClass = "bg-red-100 border-l-4 border-red-400";
                    } else if (b.type === "will_enter_band") {
                      bgClass = "bg-striped-green border-l-4 border-green-400";
                    }
                    return (
                      <li key={i} className={`rounded px-2 py-1 ${bgClass}`}>
                        {b.text}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {error}
        </p>
      )}

      {!error && entries.length === 0 && (
        <p className="text-gray-600">
          No snapshot yet. After migrations are applied and{" "}
          <code className="rounded bg-gray-100 px-1">npm run fetch-promotions</code> has run, the table will appear
          here.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <p className="mb-4 text-gray-500">
            {tierId === "league3" && promotionNews ? (
              <>
                Next scheduled update: {nextScheduledAt}
                {" "}
                · Promotion band (green target): <strong className="text-bb-text">{band}</strong> non-champion rows
              </>
            ) : (
              <>
                Last updated: {formatSnapshot(snapshotAt)}
                {previousSnapshotAt != null && (
                  <>
                    {" "}
                    · Compared to: {formatSnapshot(previousSnapshotAt)}
                  </>
                )}
                {" "}
                · Next scheduled update: {nextScheduledAt}
                {" "}
                · Promotion band (green target): <strong className="text-bb-text">{band}</strong> non-champion rows
              </>
            )}
          </p>
          <div className="overflow-x-auto rounded-lg border border-bb-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card-bg">
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">#</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Team</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">League</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Conf rank</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">W</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">L</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">PD</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Latest change</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Playoff</th>
                </tr>
              </thead>
              <tbody>
                {styledRows.map(({ row, className }) => {
                  const leagueUrl = `https://buzzerbeater.com/league/${row.league_id}/overview.aspx`;
                  return (
                    <tr
                      key={`${row.display_rank}-${row.league_id}-${row.conf}-${row.conf_rank}`}
                      className={className}
                    >
                      <td className="border border-bb-border px-3 py-2 text-left tabular-nums">
                        {row.display_rank}
                      </td>
                      <td className="border border-bb-border px-3 py-2 font-medium">
                        {row.team_url ? (
                          <a
                            href={row.team_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-exact hover:underline"
                          >
                            {row.team_name}
                          </a>
                        ) : (
                          row.team_name
                        )}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-gray-700">
                        <a
                          href={leagueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-exact hover:underline font-medium"
                        >
                          {row.league_name}{" "}
                          <span className="font-normal text-gray-400">({row.league_id})</span>
                        </a>
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left tabular-nums">
                        {row.conf_rank}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left tabular-nums">
                        {row.wins}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left tabular-nums">
                        {row.losses}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left tabular-nums">
                        {row.pd}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left">
                        <LatestChangeCell change={row.latestRankChange} />
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left font-medium text-bb-text">
                        {isPlayoffOutStatus(row.playoff_status) ? (
                          <>
                            <span className="text-red-600" aria-hidden>
                              ❌
                            </span>{" "}
                            {row.playoff_status}{" "}
                            <span className="text-red-600" aria-hidden>
                              ❌
                            </span>
                          </>
                        ) : (
                          <>
                            {row.playoff_status}
                            {row.playoff_status === "In Finals" && finalsByLeague && (() => {
                              const fi = finalsByLeague[String(row.league_id)];
                              if (!fi) return null;
                              const teamId = parseTeamIdFromUrl(row.team_url);
                              if (teamId == null) return null;
                              const isLeft = teamId === fi.leftTeamId;
                              const isRight = teamId === fi.rightTeamId;
                              if (!isLeft && !isRight) return null;
                              const myWins = isLeft ? fi.leftWins : fi.rightWins;
                              const oppWins = isLeft ? fi.rightWins : fi.leftWins;
                              
                              let label: string;
                              let colorClass: string;
                              if (myWins > oppWins) {
                                label = `Leading ${myWins}-${oppWins}`;
                                colorClass = "text-green-600";
                              } else if (myWins < oppWins) {
                                label = `Trailing ${myWins}-${oppWins}`;
                                colorClass = "text-red-600";
                              } else {
                                label = `Tied ${myWins}-${oppWins}`;
                                colorClass = "text-gray-600";
                              }
                              
                              return (
                                <span className={`ml-1.5 text-sm font-medium ${colorClass}`} title="Finals series (best of 3)">
                                  {label}
                                </span>
                              );
                            })()}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-gray-500">
        <Link href="/" className="text-exact hover:underline font-medium">
          ← Home
        </Link>
        <Link href={tier.otherTierPath} className="text-exact hover:underline font-medium">
          {tier.otherTierShortLabel} promotions →
        </Link>
      </p>
    </div>
  );
}
