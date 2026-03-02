"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";

function defaultNickname(userId: string): string {
  const hash = userId.replace(/-/g, "").slice(0, 12);
  return `User_${hash}`;
}

export function AuthNav() {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const sb = supabase;
    if (!sb) return null;
    const { data } = await sb
      .from("profiles")
      .select("nickname")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.nickname ?? null;
  }, []);

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    const init = async () => {
      const { data: { session } } = await sb.auth.getSession();
      const u = session?.user ?? null;
      setUser(u ?? null);
      if (u) {
        const nick = await fetchProfile(u.id);
        setNickname(nick);
      } else {
        setNickname(null);
      }
    };
    init();
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u ?? null);
      if (u) {
        const nick = await fetchProfile(u.id);
        setNickname(nick);
      } else {
        setNickname(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  async function signOut() {
    if (supabase) void supabase.auth.signOut();
  }

  function openEdit() {
    const current = nickname ?? (user ? defaultNickname(user.id) : "");
    setEditValue(current);
    setEditError(null);
    setShowEdit(true);
  }

  async function saveNickname() {
    if (!user?.id || !supabase) return;
    setSaving(true);
    setEditError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setEditError("Not authenticated");
        return;
      }
      const res = await fetch("/api/profile/nickname", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nickname: editValue.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setNickname(json.data.nickname);
        setShowEdit(false);
      } else {
        setEditError(json.error ?? "Failed to update");
      }
    } catch {
      setEditError("Failed to update");
    } finally {
      setSaving(false);
    }
  }

  const displayName = user
    ? (nickname ?? defaultNickname(user.id))
    : "User";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-col items-end gap-2">
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              Hello, {displayName}
            </span>
            <button
              onClick={openEdit}
              className="text-gray-500 hover:text-bb-text transition-colors p-0.5"
              title="Change nickname"
              aria-label="Change nickname"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={signOut}
              className="text-sm text-gray-600 hover:text-bb-text transition-colors"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link href="/login" className="text-sm text-exact hover:underline">
            Sign in
          </Link>
        )}
      </div>
      <Link
        href="/u21dle"
        className="rounded-lg bg-btn-lavender px-4 py-2 text-sm font-bold text-bb-text hover:opacity-90 transition-opacity shadow-md"
      >
        U21dle – Daily Puzzle
      </Link>

      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-sm w-full rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-3">Change Nickname</h2>
            <p className="text-sm text-gray-600 mb-3">
              Your nickname is shown across the site instead of your BBAPI username.
            </p>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="Enter nickname"
              className="w-full rounded-lg border border-bb-border px-4 py-2 focus:ring-2 focus:ring-exact focus:border-exact"
              autoFocus
              minLength={2}
              maxLength={30}
            />
            {editError && (
              <p className="mt-2 text-sm text-red-600">{editError}</p>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowEdit(false)}
                className="rounded-lg border border-bb-border px-4 py-2 text-sm font-medium hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={saveNickname}
                disabled={saving || editValue.trim().length < 2}
                className="rounded-lg bg-exact px-4 py-2 text-sm font-medium text-white hover:bg-[#5a9a54] disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
