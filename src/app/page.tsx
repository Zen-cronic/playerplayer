import Link from "next/link";
import { GamePage } from "./game-page";
import {
  AppShell,
  ArrowUpRight,
  DatabaseIcon,
  RouteIcon,
  SparkIcon,
} from "../components/app-shell";

export default function Home() {
  return (
    <AppShell active="game">
      <main className="demo-page">
        <section className="home-hero">
          <div className="home-story">
            <p className="eyebrow">Live judge demo · Level 01</p>
            <h1 className="home-product-name">Playtest Swarm</h1>
            <p className="home-thesis">Turn playtests into proof.</p>
            <p className="home-dek">
              Play the level once. A durable AI agent sends a matched bot swarm,
              finds where the design breaks, and proves whether your fix actually helped.
            </p>

            <div className="home-actions">
              <Link href="/chat" className="primary-link">
                Ask the swarm
                <ArrowUpRight className="action-icon" />
              </Link>
              <Link href="/dashboard" className="secondary-link">
                Open analytics
              </Link>
            </div>

            <div className="demo-loop" aria-label="Demo flow">
              <div className="demo-loop-step">
                <strong>01 · Play</strong>
                Create a human trace
              </div>
              <div className="demo-loop-step">
                <strong>02 · Ask</strong>
                Launch matched bots
              </div>
              <div className="demo-loop-step">
                <strong>03 · Prove</strong>
                Compare the change
              </div>
            </div>
          </div>

          <div className="home-game-column">
            <GamePage />
          </div>
        </section>

        <section className="proof-strip" aria-label="How the demo works">
          <div className="proof-cell">
            <RouteIcon className="proof-icon" />
            <div>
              <strong>Same game, two clocks</strong>
              <span>Humans and headless bots run the same Phaser level code.</span>
            </div>
          </div>
          <div className="proof-cell">
            <DatabaseIcon className="proof-icon" />
            <div>
              <strong>Evidence, not a fixture</strong>
              <span>Every trail and heatmap cell is queried live from ClickHouse.</span>
            </div>
          </div>
          <div className="proof-cell">
            <SparkIcon className="proof-icon" />
            <div>
              <strong>Agent-controlled experiments</strong>
              <span>Trigger.dev keeps the what-if run durable through approval and fan-out.</span>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
