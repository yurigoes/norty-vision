/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // libera microfone/câmera/geolocalização na própria origem (gravar áudio
          // no atendimento etc). Reforço caso o proxy não envie o header.
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self), camera=(self), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
