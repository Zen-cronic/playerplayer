import Link from "next/link";
import { GamePage } from "./game-page";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Playtest Swarm</h1>
          <p className="text-sm text-zinc-500">
            the agent that re-runs your level to prove the fix
          </p>
        </div>
        <nav className="flex gap-3 text-sm text-zinc-400">
          <Link href="/chat" className="hover:text-zinc-200">
            full chat
          </Link>
          <Link href="/dashboard" className="hover:text-zinc-200">
            dashboard
          </Link>
        </nav>
      </header>

      <GamePage />
    </main>
  );
}
