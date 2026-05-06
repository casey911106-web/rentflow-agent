/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rentflow/ui', '@rentflow/shared'],
  experimental: {
    typedRoutes: false,
  },
};

module.exports = nextConfig;
