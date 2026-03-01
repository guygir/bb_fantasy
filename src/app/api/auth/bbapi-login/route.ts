import { NextRequest, NextResponse } from "next/server";
import { bbapiLogin } from "@/lib/bbapi";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/bbapi-login
 * Body: { login: string, code: string }
 * Validates BBAPI creds. If valid: create/find user, return magic link.
 */
export async function POST(request: NextRequest) {
  let body: { login?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  const { login, code } = body;
  if (!login || typeof login !== "string" || !code || typeof code !== "string") {
    return NextResponse.json(
      { success: false, error: "Missing login or code" },
      { status: 400 }
    );
  }

  const trimmedLogin = login.trim();
  if (trimmedLogin.length < 2) {
    return NextResponse.json(
      { success: false, error: "Login must be at least 2 characters" },
      { status: 400 }
    );
  }

  const { ok } = await bbapiLogin(trimmedLogin, code);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: "Invalid BBAPI credentials. Please check your login and code." },
      { status: 401 }
    );
  }

  const supabase = getSupabaseAdmin();
  const email = `${trimmedLogin}@bbapi.buzzerbeater.local`;

  let authUserId: string;

  const { data: existing } = await supabase
    .from("bb_users")
    .select("auth_user_id")
    .eq("bbapi_login", trimmedLogin)
    .single();

  if (existing?.auth_user_id) {
    authUserId = existing.auth_user_id;
  } else {
    const password = crypto.randomUUID() + crypto.randomUUID();
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nickname: trimmedLogin },
    });

    if (createError) {
      if (
        createError.message.includes("already been registered") ||
        createError.message.includes("already exists")
      ) {
        const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const user = listData?.users?.find((u) => u.email === email);
        if (user) {
          authUserId = user.id;
          await supabase.from("bb_users").upsert(
            { bbapi_login: trimmedLogin, auth_user_id: authUserId },
            { onConflict: "bbapi_login" }
          );
        } else {
          return NextResponse.json(
            { success: false, error: "Could not create user. Please try again." },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json(
          { success: false, error: createError.message },
          { status: 500 }
        );
      }
    } else if (newUser?.user?.id) {
      authUserId = newUser.user.id;
      await supabase.from("bb_users").insert({
        bbapi_login: trimmedLogin,
        auth_user_id: authUserId,
      });
    } else {
      return NextResponse.json(
        { success: false, error: "Could not create user. Please try again." },
        { status: 500 }
      );
    }
  }

  const redirectTo = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${redirectTo}/` },
  });

  if (linkError || !link?.properties?.action_link) {
    return NextResponse.json(
      { success: false, error: "Could not generate sign-in link. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    redirectUrl: link.properties.action_link,
  });
}
