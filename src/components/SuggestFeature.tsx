"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase-client";

const MAX_LENGTH = 100;

interface SuggestFeatureProps {
  /** Button className - match other home page buttons */
  className?: string;
}

export function SuggestFeature({ className }: SuggestFeatureProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);

  const remaining = MAX_LENGTH - text.length;
  const canSubmit = text.trim().length > 0 && text.length <= MAX_LENGTH && !submitting;

  function closeModal() {
    if (!submitting) {
      setOpen(false);
      setText("");
      setResult(null);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/suggest-feature", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setResult({ ok: true, message: "Thanks! Your suggestion was posted.", url: data.url });
        setText("");
        setTimeout(() => closeModal(), 2000);
      } else {
        setResult({ ok: false, message: data.error ?? "Failed to submit" });
      }
    } catch {
      setResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        Suggest a Feature
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="max-w-md w-full rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-3">Suggest a Feature</h2>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
              placeholder="Describe your feature idea (max 100 characters)..."
              maxLength={MAX_LENGTH}
              rows={3}
              className="w-full rounded-lg border border-bb-border px-3 py-2 text-sm focus:ring-2 focus:ring-exact focus:border-exact resize-none"
              disabled={submitting}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className={`text-xs ${remaining < 20 ? "text-amber-600" : "text-gray-500"}`}>
                {remaining} characters left
              </span>
              <div className="flex gap-2">
                <button
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-lg border border-bb-border px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>
            {result && (
              <p className={`mt-3 text-sm ${result.ok ? "text-emerald-600" : "text-red-600"}`}>
                {result.ok && result.url ? (
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {result.message}
                  </a>
                ) : (
                  result.message
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
