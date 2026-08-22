import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sailing Simulator Pro — Ultimate",
  description:
    "A high-fidelity interactive catamaran sailing simulator with dynamic sea physics, reflective water, and responsive helm controls.",
  metadataBase: new URL("https://sailing-simulator-pro.anton-chepur.chatgpt.site"),
  openGraph: {
    title: "Sailing Simulator Pro — Ultimate",
    description:
      "Pilot a catamaran through a physically responsive ocean with wind, waves, sail trim, and cinematic lighting.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Sailing Simulator Pro — Ultimate",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sailing Simulator Pro — Ultimate",
    description: "High-fidelity interactive catamaran sailing simulator.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
