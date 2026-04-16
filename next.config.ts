import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin workspace root to this worktree. Without this, Next.js sees both
  // this worktree's lockfile and the main repo's lockfile and picks the
  // main repo as root, which means it loads source (including
  // instrumentation.ts) from the wrong tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Seed markdown files are read at runtime via fs.readFileSync (see
  // scripts/seed-builtins.ts). Vercel's static-analysis tracer can miss
  // these because the reads happen through a resolver helper, so declare
  // them explicitly for routes that call seedBuiltins.
  outputFileTracingIncludes: {
    "/setup": ["./src/db/seeds/**/*.md"],
  },
};

export default nextConfig;
