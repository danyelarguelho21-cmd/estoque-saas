import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@estoque-saas/shared"],
};

export default nextConfig;
