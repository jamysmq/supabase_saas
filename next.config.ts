import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/restaurant-menu",
        destination: "/catalogo",
        permanent: true,
      },
      {
        source: "/restaurant-orders",
        destination: "/pedidos",
        permanent: true,
      },
      {
        source: "/restaurant-finance",
        destination: "/financeiro",
        permanent: true,
      },
      {
        source: "/service-revenue",
        destination: "/financeiro",
        permanent: true,
      },
      {
        source: "/api/restaurant/:path*",
        destination: "/api/catalog/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
