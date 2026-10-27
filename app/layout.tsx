import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#061923",
};

export const metadata: Metadata = {
  title: "Enhanced Sailing Simulator Pro",
  description:
    "A high-fidelity tropical sailing simulator with GPU waves, force-based vessel physics, adaptive quality, and responsive helm controls.",
  metadataBase: new URL("https://enhanced-sailing-simulator-pro.anton-chepur.chatgpt.site"),
  openGraph: {
    title: "Enhanced Sailing Simulator Pro",
    description:
      "Pilot a detailed yacht through a physically responsive tropical ocean with wind, waves, sail trim, wildlife, and cinematic lighting.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Enhanced Sailing Simulator Pro",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Enhanced Sailing Simulator Pro",
    description: "High-fidelity interactive tropical sailing simulator.",
    images: ["/og.png"],
  },
  // The manifest link is written in <head> below: through `metadata` it would
  // be made absolute against `metadataBase`, and a manifest on another origin
  // makes the app uninstallable on any other host (previews, custom domains).
  applicationName: "Sailing Simulator",
  appleWebApp: {
    capable: true,
    title: "Sailing Simulator",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>{children}</body>
    </html>
  );
}
