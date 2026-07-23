import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Noto_Sans, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const body = Noto_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const bangla = Noto_Sans_Bengali({ variable: "--font-bangla", subsets: ["bengali"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "Jogan — Feed Procurement Intelligence",
  description: "Auditable supplier comparison for Bangladesh animal feed procurement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${body.variable} ${bangla.variable}`}><body>{children}</body></html>;
}
