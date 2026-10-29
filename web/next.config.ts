import path from "node:path";
import type { NextConfig } from "next";

// The env lives in the repo-root `.env`, which Next does not read from `web/`. Variables that are
// already set (e.g. by the shell or a container) win, because loadEnvFile never overwrites them.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "..", ".env"));
} catch {
  // No root .env: fall back to the defaults below.
}

const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@jobpilot/shared"],
  // Next's built-in gzip buffers proxied `text/event-stream` responses, which would hold back live
  // search progress from `/api/events`. Compress at the reverse proxy / CDN instead.
  compress: false,
  poweredByHeader: false,
  experimental: {
    // Rewrites to the API are proxied with a 30 s idle timeout by default; a resume upload can take
    // about that long before the API answers.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
