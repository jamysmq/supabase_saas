import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://www.meuassistentevirtual.com.br";
const siteDescription =
  "Assistente virtual para pequenos negócios: organize atendimento, cobranças, agenda e pedidos pelo WhatsApp, tudo acompanhado num painel só seu.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Assistente Jack — seu negócio organizado pelo WhatsApp",
    template: "%s | Assistente Jack",
  },
  description: siteDescription,
  keywords: [
    "assistente virtual",
    "WhatsApp para empresas",
    "cobrança automática",
    "agendamento WhatsApp",
    "gestão de pequenos negócios",
    "Assistente Jack",
  ],
  applicationName: "Assistente Jack",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: "Assistente Jack",
    title: "Assistente Jack — seu negócio organizado pelo WhatsApp",
    description: siteDescription,
    images: [
      {
        url: "/jack-hero.svg",
        alt: "Assistente Jack",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Assistente Jack — seu negócio organizado pelo WhatsApp",
    description: siteDescription,
    images: ["/jack-hero.svg"],
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
