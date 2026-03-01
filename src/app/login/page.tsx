"use client";

import { useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/bbapi-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), code }),
      });
      let data: { success?: boolean; error?: string; redirectUrl?: string };
      try {
        data = await res.json();
      } catch {
        setError(res.ok ? "Invalid response" : `Request failed (${res.status})`);
        return;
      }

      if (!data.success) {
        setError(data.error ?? "Login failed");
        return;
      }

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setError("Invalid response from server");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto flex max-w-md flex-col items-center justify-center px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold">Israel U21 Fantasy</h1>
      <p className="mb-8 text-center text-sm text-gray-600">
        Sign in with your BuzzerBeater API credentials
      </p>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div>
          <label htmlFor="login" className="mb-1 block text-sm font-medium text-gray-700">
            BBAPI Login
          </label>
          <input
            id="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Your BuzzerBeater username"
            className="w-full rounded-lg border border-bb-border px-4 py-3 focus:border-exact focus:ring-2 focus:ring-exact focus:ring-opacity-50"
            required
            minLength={2}
            autoComplete="username"
          />
        </div>
        <div>
          <label htmlFor="code" className="mb-1 block text-sm font-medium text-gray-700">
            BBAPI Code
          </label>
          <input
            id="code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Your API code (from BuzzerBeater settings)"
            className="w-full rounded-lg border border-bb-border px-4 py-3 focus:border-exact focus:ring-2 focus:ring-exact focus:ring-opacity-50"
            required
            autoComplete="current-password"
          />
          <p className="mt-1 text-xs text-gray-500">
            Get your API code from{" "}
            <a
              href="https://www.buzzerbeater.com/country/15/settings.aspx"
              target="_blank"
              rel="noopener noreferrer"
              className="text-exact hover:underline"
            >
              BuzzerBeater Settings
            </a>
          </p>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-exact py-3 font-semibold text-white transition hover:bg-[#5a9a54] disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        First time? Enter your credentials to create an account.
      </p>

      <Link href="/" className="mt-4 text-sm text-exact hover:underline">
        ← Back to home
      </Link>
    </div>
  );
}
