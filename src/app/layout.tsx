import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/providers/session-provider";

export const metadata: Metadata = {
  title: "Nexus - Activation & Subscription Manager",
  description: "Nexus Activation & Subscription Manager voor Seguilo Telematics",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", rel: "icon" },
    ],
    apple: [{ url: "/nexus-logo-128.png", sizes: "128x128", type: "image/png" }],
  },
  openGraph: {
    title: "Nexus - Activation & Subscription Manager",
    description: "Nexus Activation & Subscription Manager voor Seguilo Telematics",
    images: [{ url: "/nexus-logo-full.png", width: 2172, height: 724, alt: "Nexus logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nexus - Activation & Subscription Manager",
    description: "Nexus Activation & Subscription Manager voor Seguilo Telematics",
    images: ["/nexus-logo-full.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
