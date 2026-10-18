import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { NextConfig } from 'next';
import { z } from 'zod';

config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

const environment = z
  .object({
    API_INTERNAL_URL: z.url().default('http://127.0.0.1:3001'),
  })
  .parse({ API_INTERNAL_URL: process.env.API_INTERNAL_URL });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@mentor/api-client'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${environment.API_INTERNAL_URL.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
