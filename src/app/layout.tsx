import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";
import { SITE_URL } from "@/lib/legal";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const RAIL_SCRIPT = `try{if(localStorage.getItem("vtrade.sidebar.collapsed")==="1")document.documentElement.dataset.rail="collapsed"}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Vibrium Trade — Sourcing Suite",
  description:
    "Buying-agency sourcing automation powered by Vibrium worker and conversational agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={jakarta.className}>
        <Script id="rail-state" strategy="beforeInteractive">
          {RAIL_SCRIPT}
        </Script>
        <div className="wave-wallpaper" aria-hidden="true">
          <div className="wave-wash" />
          <svg viewBox="0 0 1440 1024" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="vibBgSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2a76e8" stopOpacity="0.30" />
                <stop offset="1" stopColor="#2a76e8" stopOpacity="0.03" />
              </linearGradient>
              <linearGradient id="vibBgWater" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#16b8d4" stopOpacity="0.30" />
                <stop offset="1" stopColor="#16b8d4" stopOpacity="0.03" />
              </linearGradient>
              <linearGradient id="vibBgGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#18b890" stopOpacity="0.32" />
                <stop offset="1" stopColor="#18b890" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <path d="M -275 456 C -229 471 -92 526 0 547 C 92 569 183 594 275 584 C 367 575 458 514 550 493 C 642 471 733 446 825 456 C 917 465 1008 526 1100 547 C 1192 569 1283 594 1375 584 C 1467 575 1604 508 1650 493 L 1440 1024 L 0 1024 Z" fill="url(#vibBgSky)" />
            <path d="M -313 672 C -260 685 -104 753 0 749 C 104 745 208 678 313 648 C 417 619 521 567 625 571 C 729 575 833 642 938 672 C 1042 701 1146 753 1250 749 C 1354 745 1510 665 1563 648 L 1440 1024 L 0 1024 Z" fill="url(#vibBgWater)" />
            <path d="M -245 862 C -204 854 -82 836 0 815 C 82 795 163 743 245 738 C 327 733 408 764 490 785 C 572 805 653 857 735 862 C 817 867 898 836 980 815 C 1062 795 1143 743 1225 738 C 1307 733 1429 777 1470 785 L 1440 1024 L 0 1024 Z" fill="url(#vibBgGreen)" />
          </svg>
        </div>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
