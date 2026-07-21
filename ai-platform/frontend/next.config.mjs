/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL;
    if (!backend) return [];
    // Optional server-side proxy so the browser can hit /api/* same-origin.
    return [{ source: '/api/backend/:path*', destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
