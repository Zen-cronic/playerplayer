import type { Metadata } from "next";
import "./globals.css";
// The copilot's compiled utilities — the app imports the published stylesheet
// exactly as an external consumer would, rather than relying on its own Tailwind
// to scan the (now out-of-tree) widget source.
import "@playerplayer/sdk/styles.css";

export const metadata: Metadata = {
  title: "PlayerPlayer",
  description: "The agent that re-runs your level to prove the fix.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
