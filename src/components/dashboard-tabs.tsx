import Link from "next/link";

export type DashboardTab = "overview" | "runs" | "agent" | "live";

const TABS: Array<{ id: DashboardTab; href: string; label: string }> = [
  { id: "overview", href: "/dashboard", label: "Overview" },
  { id: "runs", href: "/dashboard/runs", label: "Runs" },
  { id: "agent", href: "/dashboard/agent", label: "Agent log" },
  { id: "live", href: "/dashboard/live", label: "Live ops" },
];

export function DashboardTabs({ active }: { active: DashboardTab }) {
  return (
    <nav className="dash-tabs" aria-label="Dashboard sections">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className="dash-tab"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
