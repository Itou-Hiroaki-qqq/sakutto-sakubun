import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 画像添削で base64 画像を送るため、デフォルト 1MB を引き上げ（写真は base64 で約 1.33 倍になる）
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
