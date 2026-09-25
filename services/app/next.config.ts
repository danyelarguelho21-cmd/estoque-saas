import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@estoque-saas/shared"],
  webpack: (config) => {
    // Webpack's persistent filesystem cache (FileSystemInfo) hashes
    // "managed item" directories under node_modules to detect changes
    // between builds. On this machine that hash computation is crashing
    // with "Cannot read properties of undefined (reading 'length')"
    // inside its WASM-backed hasher (WasmHash._updateWithBuffer) because
    // some directory entry resolves to an undefined hash — most likely
    // caused by the project living under a OneDrive-synced folder
    // (Desktop), where cloud "placeholder" files can make a directory
    // read behave unexpectedly. Disabling the persistent cache skips
    // that code path entirely. Build/rebuild is a bit slower without it,
    // but it's reliable.
    config.cache = false;
    return config;
  },
};

export default nextConfig;
