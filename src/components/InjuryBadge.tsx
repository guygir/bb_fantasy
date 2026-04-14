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
  return (
    <span className="block text-xs font-semibold text-red-600 leading-tight">
      INJURED! {injuryDaysMin}-{injuryDaysMax} days
    </span>
  );
}
