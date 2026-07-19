import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playtest Swarm",
  description: "The agent that re-runs your level to prove the fix.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
