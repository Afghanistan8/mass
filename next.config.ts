import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// The app talks to exactly one network host (Studionet RPC) and is never meant to be framed: it can trigger wallet
// transactions, so clickjacking protection matters. CSP is production-only because `next dev` needs eval.
// 'unsafe-inline' for scripts is required by Next.js's inline bootstrap unless a nonce proxy is added.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://studio.genlayer.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: path.resolve(process.cwd()) },
  // Inlined at build time so /api/build-info reports the real build time, not the request time.
  env: { BUILD_TIME: new Date().toISOString() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
