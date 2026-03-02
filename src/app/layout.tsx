import type { Metadata } from "next";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "BB Israel U21 Fantasy",
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
              <NavLinks />
            </div>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
