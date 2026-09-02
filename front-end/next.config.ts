import type { NextConfig } from "next";

/**
 * Static export is opt-in through STATIC_EXPORT rather than always on.
 *
 * `next dev` and a plain `next build` are left exactly as they were, so the
 * live client keeps working locally; only the Render build sets the flag. The
 * deployed site is the portfolio page alone - it needs no server, and the live
 * client it would otherwise ship is a page that opens a WebSocket to a backend
 * that is not deployed.
 */
const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT ? "export" : undefined,

  // Verified, not assumed: without this the export emits portfolio.html, and
  // the build step that promotes the page to the site root
  // (cp out/portfolio/index.html out/index.html) has nothing to copy. With it,
  // each route becomes its own directory with an index.html.
  trailingSlash: true,
};

export default nextConfig;
