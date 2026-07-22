import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo app dogfoods the published SDK: it imports `playtest-copilot` (the
  // workspace package) rather than the source directly. transpilePackages lets
  // Next compile the package's ESM/JSX in the app's build graph.
  transpilePackages: ["playtest-copilot"],
};

export default nextConfig;
