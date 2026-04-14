import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Seed markdown files are read at runtime via fs.readFileSync (see
  // scripts/seed-builtins.ts). Vercel's static-analysis tracer can miss
  // these because the reads happen through a resolver helper, so declare
  // them explicitly for routes that call seedBuiltins.
  outputFileTracingIncludes: {
    "/setup": ["./src/db/seeds/**/*.md"],
  },
};

export default nextConfig;
