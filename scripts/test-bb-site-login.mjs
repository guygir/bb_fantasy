#!/usr/bin/env node
/**
 * Verify buzzerbeater.com form login via Puppeteer (same path as CI: getBuzzerbeaterCookieHeaderFromLogin).
 *
 *   node scripts/test-bb-site-login.mjs
 *
 * Env: BB_PASSWORD (required). Mimic CI: CI=1 PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
 */
import { getBuzzerbeaterCookieHeaderFromLogin } from "./lib/bb-site-session.mjs";

const t0 = Date.now();
getBuzzerbeaterCookieHeaderFromLogin()
  .then((header) => {
    const ms = Date.now() - t0;
    console.log(`OK (${ms}ms) — session cookie header length ${header.length}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
