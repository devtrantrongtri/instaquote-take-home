import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve PDF.js's native Node import and sibling pdf.worker.mjs resolution.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
