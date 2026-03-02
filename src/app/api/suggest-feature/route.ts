import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_LENGTH = 100;

function getSupabaseWithAuth(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/** Sanitize: strip HTML, control chars, trim, limit length */
function sanitize(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_LENGTH);
}

/**
 * POST /api/suggest-feature
 * Body: { text: string }
 * Creates a GitHub issue. Requires auth. Title includes user's BBAPI username.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const supabase = getSupabaseWithAuth(authHeader);
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Server config error" }, { status: 500 });
  }

  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token ?? "");
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Sign in to suggest a feature" }, { status: 401 });
  }

  if (!config.githubRepo) {
    return NextResponse.json({
      success: false,
      error: "Suggestions not configured. Add NEXT_PUBLIC_GITHUB_REPO (e.g. owner/repo) to env.",
    }, { status: 503 });
  }

  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GITHUB_ACCESS_TOKEN;
  if (!githubToken?.trim()) {
    return NextResponse.json({
      success: false,
      error: "Suggestions not configured. Add GITHUB_TOKEN to .env.local and restart the dev server (npm run dev).",
    }, { status: 503 });
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw = typeof body?.text === "string" ? body.text : "";
  const text = sanitize(raw);
  if (!text) {
    return NextResponse.json({ success: false, error: "Please enter a suggestion (max 100 characters)" }, { status: 400 });
  }

  // Get BBAPI username from profiles (nickname = BBAPI login for BB users)
  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  const bbapiUsername = profile?.nickname ?? user.email?.replace(/@bbapi\.buzzerbeater\.local$/, "") ?? "anonymous";

  const [owner, repo] = config.githubRepo.split("/");
  if (!owner || !repo) {
    return NextResponse.json({ success: false, error: "Invalid repo config" }, { status: 500 });
  }

  const title = `Feature suggestion from ${bbapiUsername}`;
  const issueBody = `**Suggestion from ${bbapiUsername}:**\n\n${text}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body: issueBody,
      labels: ["enhancement"],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("GitHub API error:", res.status, err);
    return NextResponse.json(
      { success: false, error: "Failed to create issue. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    success: true,
    url: data.html_url,
  });
}
