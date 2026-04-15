/**
 * Single Puppeteer entry: puppeteer-extra + stealth plugin so headless login works on CI
 * without pasting browser cookies (reduces automation fingerprint vs raw puppeteer).
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

export const PUPPETEER_DEFAULT_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

export function launchBbBrowser(launchOpts) {
  return puppeteer.launch(launchOpts);
}
