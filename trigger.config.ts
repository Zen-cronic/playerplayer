import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  build: {
    // canvas is native; jsdom resolves worker files at runtime — neither
    // survives bundling. Phaser + the shim ride along unbundled with them.
    // The game assets must ship alongside the bundled bot-run task.
    external: ["canvas", "jsdom", "phaser", "@geckos.io/phaser-on-nodejs"],
    extensions: [additionalFiles({ files: ["vendor/tilemap-pack/assets/**"] })],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      randomize: true,
    },
  },
});
