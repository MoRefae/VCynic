import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
};
export default nextConfig;
