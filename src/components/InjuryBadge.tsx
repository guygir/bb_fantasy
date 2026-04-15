/** Red injury line under player name (BuzzerBeater overview "Injury! X - Y days"). */
export function InjuryBadge({
  injuryDaysMin,
  injuryDaysMax,
}: {
  injuryDaysMin?: number | null;
  injuryDaysMax?: number | null;
}) {
  if (
    injuryDaysMin == null ||
    injuryDaysMax == null ||
    Number.isNaN(injuryDaysMin) ||
    Number.isNaN(injuryDaysMax)
  ) {
    return null;
  }
  const unknownRange = injuryDaysMin === 0 && injuryDaysMax === 0;
  return (
    <span
      className="mt-0.5 inline-block rounded-md bg-gradient-to-b from-red-500 to-red-700 px-2 py-0.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-white shadow-[0_0_8px_rgba(239,68,68,0.85),0_0_18px_rgba(248,113,113,0.35)] ring-1 ring-red-300/90 sm:text-[11px]"
      title={
        unknownRange
          ? "Injured (open BuzzerBeater for day range)"
          : `Out ${injuryDaysMin}–${injuryDaysMax} days (BuzzerBeater injury estimate)`
      }
    >
      {unknownRange ? "INJURED!" : `INJURED! ${injuryDaysMin}–${injuryDaysMax} days`}
    </span>
  );
}
