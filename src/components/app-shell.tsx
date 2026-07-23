import Link from "next/link";
import type { ReactNode } from "react";

export type DemoRoute = "game" | "chat" | "analytics";

export function SwarmMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 8.5 11 5l5 3.5v5L11 17l-5-3.5v-5Z" fill="currentColor" />
      <path d="m16 18.5 5-3.5 5 3.5v5L21 27l-5-3.5v-5Z" fill="currentColor" opacity=".78" />
      <path d="m18.5 6 3-2 3 2v3l-3 2-3-2V6Z" fill="currentColor" opacity=".42" />
      <path d="M12.5 17.5 17 14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const routes: Array<{ id: DemoRoute; href: string; label: string; index: string }> = [
  { id: "game", href: "/", label: "Play", index: "01" },
  { id: "chat", href: "/chat", label: "Ask", index: "02" },
  { id: "analytics", href: "/dashboard", label: "Analyze", index: "03" },
];

export function AppHeader({ active }: { active: DemoRoute }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand-lockup" aria-label="PlayerPlayer home">
          <span className="brand-mark-wrap">
            <SwarmMark className="brand-mark" />
          </span>
          <span>
            <span className="brand-name">PlayerPlayer</span>
            <span className="brand-subtitle">AI playtest operations</span>
          </span>
        </Link>

        <nav className="demo-nav" aria-label="Demo navigation">
          {routes.map((route) => (
            <Link
              key={route.id}
              href={route.href}
              aria-current={active === route.id ? "page" : undefined}
              className="demo-nav-link"
            >
              <span className="demo-nav-index">{route.index}</span>
              <span>{route.label}</span>
            </Link>
          ))}
        </nav>

        <div className="global-live" aria-label="Demo system is live">
          <span className="live-dot" aria-hidden="true" />
          <span>System live</span>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ active, children }: { active: DemoRoute; children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppHeader active={active} />
      {children}
    </div>
  );
}

export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 12 12 4M6 4h6v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 1.5c.45 4.85 3.65 8.05 8.5 8.5-4.85.45-8.05 3.65-8.5 8.5C9.55 13.65 6.35 10.45 1.5 10 6.35 9.55 9.55 6.35 10 1.5Z" fill="currentColor" />
    </svg>
  );
}

export function DatabaseIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="4.2" rx="6.5" ry="2.7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 4.2v5.7c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V4.2M3.5 9.8v5.7c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V9.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function RouteIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="2" fill="currentColor" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <path d="M4 6v3.5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3V16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 4h6a3 3 0 0 1 3 3v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
