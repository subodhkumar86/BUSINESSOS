/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir:
    process.env.BUSINESSOS_BROWSER_TEST === 'live'
      ? '.cache/next-live'
      : process.env.BUSINESSOS_BROWSER_TEST === 'demo'
        ? '.cache/next-demo'
        : '.next',
  poweredByHeader: false,
  serverExternalPackages: ['mongodb'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}
export default nextConfig
