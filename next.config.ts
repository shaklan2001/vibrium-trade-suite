import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Keep client sample artefacts available to the samples API on Vercel.
  outputFileTracingIncludes: {
    "/api/samples/[...path]": ["./docs/samples/**/*"],
  },
};

export default nextConfig;
