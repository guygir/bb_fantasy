"use client";

import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/players", label: "Players" },
  { href: "/pick", label: "Pick Team" },
  { href: "/roster", label: "My Roster" },
  { href: "/schedule", label: "Schedule" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/help", label: "Help" },
];

export function NavLinks() {
  return (
    <>
      <h1 className="text-lg font-bold sm:text-xl text-bb-text">
        <a href="/" className="hover:opacity-80 transition-opacity">
          BB Israel U21 Fantasy
        </a>
      </h1>
      <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
        {links.filter((l) => l.href !== "/" && l.href !== "/pick").map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="hover:text-bb-text transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
