import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  build: {
    // canvas is a native module (required by phaser-on-nodejs); the game
    // assets must ship alongside the bundled bot-run task.
    external: ["canvas"],
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
