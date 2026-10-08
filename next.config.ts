import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Roster CSVs are read at request time (`lib/data.ts`). Include them in the
  // serverless bundle so a Vercel deploy does not 500 on a missing file.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*"],
  },
};

export default nextConfig;
