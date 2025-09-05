/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    // 开发时保留 /api 前缀，不在此处硬编码后端地址
    return [];
  },
};

module.exports = nextConfig;
