import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@estoque-saas/shared"],
  // Playwright's e2e webServer (tests/e2e/playwright.config.ts) sets NEXT_DIST_DIR so its
  // `next dev --turbopack` never shares services/app/.next with a developer's own `npm run dev`
  // (webpack) running at the same time. Two bundlers writing the same incremental build cache
  // concurrently corrupted it in place — Turbopack's CSS parser treated the interleaved/partial
  // write as a fatal syntax error ("Unexpected token Delim('-')" in a generated globals.css
  // chunk), while webpack merely warned. Next's own crash-recovery (renaming the unusable cache
  // to `.next-stale-<id>` and starting fresh) is what surfaced this — an isolated distDir avoids
  // the race instead of relying on that recovery path.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack: (config, { dev }) => {
    // Webpack's persistent filesystem cache (FileSystemInfo) hashes
    // "managed item" directories under node_modules to detect changes
    // between builds. On this machine that hash computation crashes
    // with "Cannot read properties of undefined (reading 'length')"
    // inside its WASM-backed hasher (WasmHash._updateWithBuffer) because
    // some directory entry resolves to an undefined hash — most likely
    // caused by the project living under a OneDrive-synced folder
    // (Desktop), where cloud "placeholder" files can make a directory
    // read behave unexpectedly.
    //
    // This only ever happened during `next build` (production build),
    // never during `next dev`. Disabling the persistent cache in dev
    // mode too made every route compile from scratch on first visit
    // (no incremental reuse), which is fine locally but was slow enough
    // under CI's constrained runner to time out Playwright E2E waits.
    // So scope the workaround to production builds only.
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
  async headers() {
    // Applied via Next's headers() (not only deploy/Caddyfile) so dev, the Playwright e2e
    // webServer, and production all send the same headers — the e2e suite re-run after this
    // change is what actually exercises them, not just a manual prod check.
    //
    // - script-src/style-src need 'unsafe-inline': Next.js's own hydration bootstrap renders an
    //   inline <script id="_R_"> on every page, and at least one component uses a React inline
    //   `style` attribute — both would be silently blocked (broken hydration / unstyled content)
    //   under a stricter policy. No nonce plumbing exists in this app yet; adding one is a larger
    //   change than "add security headers without breaking flows" calls for.
    // - connect-src/img-src/frame-src stay 'self'-only: confirmed (reading layout.tsx,
    //   assinatura/page.tsx, lib/payments/pagbank.ts) there is no PagBank.js script tag, no
    //   PagBank-hosted image, and no checkout iframe anywhere yet — the boleto link is a plain
    //   external `<a target="_blank">` and the Pix "QR code" is a text label, not an embedded
    //   image. Fonts are self-hosted via next/font/google. If PagBank.js card tokenization
    //   (currently an unimplemented stub — pagbank.ts's tokenizeCard) is wired up later, its
    //   script/frame domains must be added here.
    // - frame-ancestors 'none' (+ X-Frame-Options: DENY as a legacy fallback for older browsers):
    //   nothing in this app embeds itself in an iframe, so there's no SAMEORIGIN use case to
    //   preserve.
    // - HSTS is only honored by browsers over an already-secure (HTTPS) connection, so sending it
    //   here too is a no-op in local/e2e http dev and only takes effect in production behind
    //   Caddy's TLS.
    // - None of this touches the PagBank webhook (api/webhooks/pagbank) — these are all
    //   *response* headers for browser-rendered pages; they have no effect on an inbound
    //   server-to-server POST or its x-authenticity-token signature check.
    // - 'unsafe-eval' in script-src is DEV-ONLY: React's dev-mode debugging (reconstructing
    //   component stacks in the dev overlay) calls eval(); confirmed via the e2e suite's browser
    //   console ("eval() is not supported ... React will never use eval() in production mode").
    //   Never added in production, where React confirms it never uses eval() anyway.
    const isDev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
