import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // OCR (src/lib/mail/ocr.ts): tesseract.js starts its own worker thread and @napi-rs/canvas is a
  // native module, so both load from node_modules instead of being bundled.
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas"],
  // Keep client sample artefacts available to the samples API on Vercel.
  outputFileTracingIncludes: {
    "/api/samples/[...path]": ["./docs/samples/**/*"],
  },
};

export default nextConfig;
