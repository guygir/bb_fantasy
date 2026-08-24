#!/usr/bin/env node
/**
 * Validate U21 return-vs-new: W1 + Saturday W2 do not count.
 */
import {
  competitiveRosterStartDate,
  getSeasonStartMs,
} from "./lib/season-calendar.mjs";
import {
  closedStintCountsForRosterReturn,
  reclassifyRosterReturnEvents,
  shouldClassifyAsReturn,
} from "./lib/u21-tracker-shared.mjs";

let failed = 0;
function assert(name, cond, extra = "") {
  if (cond) console.log(`ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const s73 = 73;
assert("S73 starts Saturday 2026-08-08", new Date(getSeasonStartMs(s73)).toISOString().startsWith("2026-08-08"));
assert("S73 competitive start is Sunday W2 2026-08-16", competitiveRosterStartDate(s73) === "2026-08-16");
assert("S72 competitive start is Sunday W2 2026-05-10", competitiveRosterStartDate(72) === "2026-05-10");

assert("W1 leave does not count", !closedStintCountsForRosterReturn(s73, { toWeek: 1, toDate: "2026-08-12" }));
assert("Saturday W2 leave does not count", !closedStintCountsForRosterReturn(s73, { toWeek: 2, toDate: "2026-08-15" }));
assert("Sunday W2 leave counts", closedStintCountsForRosterReturn(s73, { toWeek: 2, toDate: "2026-08-16" }));
assert("Friday W2 leave counts", closedStintCountsForRosterReturn(s73, { toWeek: 2, toDate: "2026-08-21" }));
assert("W3 leave counts", closedStintCountsForRosterReturn(s73, { toWeek: 3, toDate: "2026-08-22" }));

const w1Only = {
  countryId: 19,
  stints: [{ fromWeek: 1, toWeek: 1, fromDate: "2026-08-08", toDate: "2026-08-12" }],
};
assert(
  "W1 then join W4 is NEW",
  !shouldClassifyAsReturn(s73, w1Only, 19)
);

const satW2 = {
  countryId: 19,
  stints: [{ fromWeek: 1, toWeek: 2, fromDate: "2026-08-08", toDate: "2026-08-15" }],
};
assert(
  "W1 + Saturday W2 leave then join W4 is NEW",
  !shouldClassifyAsReturn(s73, satW2, 19)
);

const sunW2 = {
  countryId: 19,
  stints: [{ fromWeek: 1, toWeek: 2, fromDate: "2026-08-08", toDate: "2026-08-16" }],
};
assert(
  "Present Sunday W2, left, later rejoin is RETURN",
  shouldClassifyAsReturn(s73, sunW2, 19)
);

const exampleEvents = [
  { playerId: 1, countryId: 19, type: "left", date: "2026-08-15", week: 2, name: "SatW2" },
  { playerId: 1, countryId: 19, type: "returned", date: "2026-08-29", week: 4, name: "SatW2", weeksAway: 2 },
  { playerId: 2, countryId: 19, type: "left", date: "2026-08-12", week: 1, name: "W1" },
  { playerId: 2, countryId: 19, type: "returned", date: "2026-08-29", week: 4, name: "W1", weeksAway: 3 },
  { playerId: 3, countryId: 19, type: "left", date: "2026-08-16", week: 2, name: "SunW2" },
  { playerId: 3, countryId: 19, type: "returned", date: "2026-08-29", week: 4, name: "SunW2", weeksAway: 2 },
];
const rewritten = reclassifyRosterReturnEvents(s73, exampleEvents);
assert("example Sat W2 → joined", rewritten[1].type === "joined" && rewritten[1].weeksAway == null);
assert("example W1 leave → joined", rewritten[3].type === "joined" && rewritten[3].weeksAway == null);
assert("example Sunday W2 stays returned", rewritten[5].type === "returned" && rewritten[5].weeksAway === 2);

const live = await fetch(
  "https://raw.githubusercontent.com/guygir/bb_fantasy/main/data/u21-tracker/s73/roster-events.json"
).then((r) => r.json());
const liveRewritten = reclassifyRosterReturnEvents(73, live.events);
const watch = [
  [55042910, "Boris Khrustalev"],
  [55139859, "Miloš Mikuliak"],
  [55443908, "Marián Kalinák"],
  [55141049, "Pauli Meltola"],
];
console.log("\n--- live S73 watched players ---");
for (const [id, name] of watch) {
  const before = live.events.filter((e) => e.playerId === id);
  const after = liveRewritten.filter((e) => e.playerId === id);
  console.log(name);
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    const flip = b.type !== a.type ? ` → ${a.type}` : "";
    console.log(`  ${b.date} W${b.week} ${b.type}${b.weeksAway != null ? ` ${b.weeksAway}w` : ""}${flip}`);
  }
  const lastReturn = after.find((e) => e.date === "2026-08-22");
  assert(`${name} 22 Aug is joined (NEW)`, lastReturn?.type === "joined");
}

const flipped = live.events
  .map((e, i) => ({ before: e, after: liveRewritten[i] }))
  .filter((row) => row.before.type === "returned" && row.after.type === "joined");
console.log(`\nS73 returned→joined: ${flipped.length} / ${live.events.filter((e) => e.type === "returned").length} returned`);
const kept = live.events.filter((e, i) => e.type === "returned" && liveRewritten[i].type === "returned");
console.log("kept as returned:", kept.length);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
