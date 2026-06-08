/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 本项目素材全部来自 public/ 本地文件，且未使用 next/image（均为原生 <img>）。
  // 因此不开放任何远端图源，避免 /_next/image 沦为开放图片代理（SSRF/带宽滥用面）。
  // 后端阶段若改用 CDN，再按白名单把具体可信主机精确加进 images.remotePatterns。
};

export default nextConfig;
