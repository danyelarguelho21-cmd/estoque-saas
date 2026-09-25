import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@estoque-saas/shared"],
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
};

export default nextConfig;
