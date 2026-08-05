/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    // Only hosts listed here may go through next/image. Course thumbnails are
    // admin-pasted URLs from arbitrary hosts, so those deliberately stay plain
    // <img> — an unlisted host makes next/image throw and blanks the page.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
}

module.exports = nextConfig
