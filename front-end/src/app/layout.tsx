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

const SITE_URL = "https://voice-reservation-agent.onrender.com";
const OG_IMAGE = "/voice-hotel-reservation-agent.png";

/**
 * metadataBase is what lets every URL below stay relative. Next resolves them
 * against it at build time, so og:url and og:image come out absolute - which
 * they must be, since scrapers do not resolve relative image paths.
 *
 * canonical is "/" rather than "/portfolio" deliberately: the Render build ends
 * by copying out/portfolio/index.html over out/index.html, so the same document
 * is served at both paths and the root is the one to consolidate on.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Real-Time Voice Hotel Reservation Agent",
  description:
    "A real-time voice AI agent that understands hotel booking requests and executes reservation workflows through natural conversation.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    title: "Real-Time Voice Hotel Reservation Agent",
    description:
      "Streaming voice AI for hotel reservations, built with Amazon Nova Sonic, WebSockets, tool execution, and DynamoDB.",
    url: "/",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Real-time voice waveform connecting to a hotel reservation calendar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Real-Time Voice Hotel Reservation Agent",
    description:
      "A streaming voice AI agent for conversational hotel booking workflows.",
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
