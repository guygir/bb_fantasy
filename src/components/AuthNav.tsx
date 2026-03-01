"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";

export function AuthNav() {
  const [user, setUser] = useState<{ email?: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  const displayName = user?.email?.replace(/@bbapi\.buzzerbeater\.local$/, "") ?? "User";

  return (
    <div className="flex items-center gap-3">
      {user ? (
        <>
          <span className="text-sm text-gray-600">{displayName}</span>
          <button
            onClick={signOut}
            className="text-sm text-gray-600 hover:text-bb-text transition-colors"
          >
            Sign out
          </button>
        </>
      ) : (
        <Link href="/login" className="text-sm text-exact hover:underline">
          Sign in
        </Link>
      )}
    </div>
  );
}
