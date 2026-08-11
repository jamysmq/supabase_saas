import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  ASSISTANT_PRODUCT_NAME,
  OFFICIAL_SITE_URL,
} from "@/src/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = OFFICIAL_SITE_URL;
const siteDescription =
  "Assistente virtual para pequenos negócios: organize atendimento, cobranças, agenda e pedidos pelo WhatsApp, tudo acompanhado num painel só seu.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${ASSISTANT_PRODUCT_NAME} — seu negócio organizado pelo WhatsApp`,
    template: `%s | ${ASSISTANT_PRODUCT_NAME}`,
  },
  description: siteDescription,
  keywords: [
    "assistente virtual",
    "WhatsApp para empresas",
    "cobrança automática",
    "agendamento WhatsApp",
    "gestão de pequenos negócios",
    ASSISTANT_PRODUCT_NAME,
  ],
  applicationName: ASSISTANT_PRODUCT_NAME,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: ASSISTANT_PRODUCT_NAME,
    title: `${ASSISTANT_PRODUCT_NAME} — seu negócio organizado pelo WhatsApp`,
    description: siteDescription,
    images: [
      {
        url: "/joao-hero.svg",
        alt: ASSISTANT_PRODUCT_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${ASSISTANT_PRODUCT_NAME} — seu negócio organizado pelo WhatsApp`,
    description: siteDescription,
    images: ["/joao-hero.svg"],
  },
  other: {
    "facebook-domain-verification": "lz33kutsdum6rvful80368do81pyk4",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
