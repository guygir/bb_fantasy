import type { Metadata } from "next";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";

export const metadata: Metadata = {
  title: "Israel U21 Fantasy",
  description: "Fantasy basketball based on Israel U21 National Team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col text-bb-text">
        <header className="border-b border-bb-border bg-card-bg px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold sm:text-xl text-bb-text">
                <a href="/" className="hover:opacity-80 transition-opacity">Israel U21 Fantasy</a>
              </h1>
              <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            <a href="/" className="hover:text-bb-text transition-colors">Home</a>
            <a href="/players" className="hover:text-bb-text transition-colors">Players</a>
            <a href="/pick" className="hover:text-bb-text transition-colors">Pick Team</a>
            <a href="/roster" className="hover:text-bb-text transition-colors">My Roster</a>
            <a href="/schedule" className="hover:text-bb-text transition-colors">Schedule</a>
            <a href="/leaderboard" className="hover:text-bb-text transition-colors">Leaderboard</a>
            <a href="/u21dle" className="hover:text-bb-text transition-colors">U21dle</a>
            <a href="/help" className="hover:text-bb-text transition-colors">Help</a>
          </nav>
            </div>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
