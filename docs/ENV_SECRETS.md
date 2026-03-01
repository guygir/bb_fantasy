# Environment & Secrets

## Where to add secrets

| Secret | GitHub Actions | .env.local | Vercel |
|--------|----------------|------------|--------|
| BBAPI_LOGIN | ✅ | ✅ | ❌ (client uses user's) |
| BBAPI_CODE | ✅ | ✅ | ❌ |
| BB_PASSWORD | ✅ (cron runs sync-roster-faces) | Only if you run `sync-roster-faces` or `fetch-player-face` locally | ❌ |
| NEXT_PUBLIC_SUPABASE_URL | ✅ | ✅ | ✅ |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | ✅ | ✅ (if server needs it) |

## BB_PASSWORD

- **What:** Main BuzzerBeater site password (login to buzzerbeater.com)
- **Not:** BBAPI_CODE (read-only API code)
- **Used by:** `scripts/fetch-player-face.mjs`, `scripts/sync-roster-faces.mjs`
- **GitHub:** Add as repository secret for `fantasy-weekly-sync` workflow (required for cron)
- **Local:** Add to `.env.local` only if you run `sync-roster-faces` or `fetch-player-face` manually
- **Note:** BuzzerBeater login may use reCAPTCHA; automated Puppeteer login can fail. See `data/README.md`.
