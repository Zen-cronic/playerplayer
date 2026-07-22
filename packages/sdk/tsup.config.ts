import { defineConfig } from "tsup";

// The widget is a React client component tree. We ship ESM + types and keep the
// host's libraries (React, the AI SDK, the Trigger transport) as peers so a
// consumer resolves one copy. The Tiled map JSON is the only thing bundled in.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  external: [/^react/, /^react-dom/, /^@ai-sdk\//, /^ai$/, /^@trigger\.dev\//],
  // NB: bundling collapses the per-file "use client" directives, and esbuild
  // strips a banner directive too ("module level directives cause errors when
  // bundled"). scripts/prepend-use-client.mjs re-adds it after the build so the
  // entry stays a valid client-component module for Server Component importers.
});
