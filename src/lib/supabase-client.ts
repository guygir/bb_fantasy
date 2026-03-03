/**
 * Supabase client for browser - used for auth session.
 * Note: "Lock was stolen" with multiple tabs is a known supabase-js bug.
 * Try: npm install @supabase/supabase-js@canary (fix in canary as of Feb 2026)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
