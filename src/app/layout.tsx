import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { Navbar } from "@/components/layout/Navbar";
import { PremiumBackground } from "@/components/effects/PremiumBackground";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "PeerTalks — Connect with People Around the World",
    template: "%s — PeerTalks",
  },
  description:
    "PeerTalks is a premium social connection platform. Video chat and text chat with people worldwide through random matching, interest-based connections, or private rooms.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "PeerTalks",
    title: "PeerTalks — Connect with People Around the World",
    description:
      "A premium social connection platform for meaningful conversations through video and text.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PeerTalks — Connect with People Around the World",
    description:
      "A premium social connection platform for meaningful conversations through video and text.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f11",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans selection:bg-white/10 selection:text-white">
        <PremiumBackground />
        <div className="noise" />
        <a
          href="#main-content"
          className="fixed -top-20 left-4 z-[100] px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-white/50 focus-visible:top-4 transition-all duration-500 backdrop-blur-xl"
        >
          Skip to content
        </a>
        <Providers>
          <Navbar />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
