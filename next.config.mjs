/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  assetPrefix: "./",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true
  }
};
export default nextConfig;

