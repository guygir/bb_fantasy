# Code Review – Fixable Issues

## Fixed (2025-02)

- **Configurable season** – `config.game.currentSeason` from `NEXT_PUBLIC_CURRENT_SEASON` / `CURRENT_SEASON`
- **Dead code** – Removed `src/lib/data.ts` (playersWithPrices)
- **Error handling** – Roster/pick fetches check `res.ok`; login handles non-JSON; players logs BBAPI failures
- **Hardcoded values** – `israelU21TeamId` from `ISRAEL_U21_TEAM_ID` env; scripts use env

---

## Remaining (low priority)

### Missing error handling on fetches
- **`src/app/roster/page.tsx`** – Fetch calls don't check `res.ok`; 4xx/5xx can cause parse errors
- **`src/app/pick/page.tsx`** – Same; failed fetch leaves empty list with no user feedback
- **`src/app/u21dle/page.tsx`** – Fetch without `res.ok` check
- **`src/app/login/page.tsx`** – `res.json()` on non-JSON error (e.g. 500 HTML) can throw
- **Fix:** Check `res.ok` before `res.json()`; show user-facing error on failure

---

## Medium priority

### Dead code
- **`src/lib/data.ts`** – `playersWithPrices()` never imported; reads `season70_stats.json`

### Inconsistencies
- **`src/lib/data.ts`** – Uses season 70 while app targets 71
- **Scripts** – Hardcode `TEAM_ID=1015`; use `config.game.israelU21TeamId`

### Potential bugs
- **`src/app/roster/page.tsx`** – Sub-window fetch runs when user not signed in (minor)
- **`src/app/pick/page.tsx`** – Malformed API response can pass `undefined` to `setPlayers`
- **`src/app/u21dle/page.tsx`** – Invalid localStorage JSON silently ignored

---

## Low priority

### Hardcoded values
- **`src/lib/config.ts`** – `israelU21TeamId: 1015`, default BBAPI creds; consider env

### Accessibility
- **Roster/pick/U21dle** – Buttons could use `aria-label` for screen readers

---

## Summary

| Category        | Count | Effort |
|-----------------|-------|--------|
| Hardcoded season| 15+   | Medium |
| Error handling  | 6+    | Low    |
| Dead code       | 1     | Low    |
| Inconsistencies | 4     | Low    |
| Potential bugs  | 3     | Low    |
