import type { NextConfig } from "next";

import { parseWebEnv } from "@yt-monitor/config";

const webEnv = parseWebEnv(process.env);

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@yt-monitor/config", "@yt-monitor/shared"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${webEnv.API_INTERNAL_URL}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
