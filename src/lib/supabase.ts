/**
 * Supabase client - server-side only.
 * Uses anon key for reads (RLS allows public read on u21dle_daily).
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabase() {
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey);
}

/** Service role client - bypasses RLS. Use only in trusted server context (cron, API). */
export function getSupabaseAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin client");
  }
  return createClient(url, serviceKey);
}
