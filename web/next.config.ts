import path from "node:path";
import type { NextConfig } from "next";

// Load the repo-root .env so API_INTERNAL_URL is shared with the server config.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));
} catch {
  // no .env file: rely on real environment variables
}

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@jobpilot/shared"],
  // Browser only ever talks to this Next server; /api/* is proxied server-side to Express,
  // so the session cookie is first-party and no API URL or secret reaches the client bundle.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  poweredByHeader: false,
  experimental: {
    // Generating search queries waits on an LLM call; the rewrite proxy's default is 30s.
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
