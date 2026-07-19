import type { Metadata, Viewport } from "next";
import { Saira_Condensed, Inter, Space_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { FootballIntro } from "@/components/FootballIntro";

// Broadcast score-bug display, clean body, ledger/receipt mono.
const display = Saira_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ProofCast — the whole match, on the record",
  description:
    "A verified football match-centre: full on-chain stats — possession, shots, corners, cards and goals — for every fixture, plus AI recaps narrated aloud. Every figure and every fact links to its TxLINE proof on Solana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#06150c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        {/* Gate the intro before paint: if it already ran this tab session, mark the
            document so <FootballIntro> never mounts and there's no flash on reload. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(sessionStorage.getItem('pc-intro')==='1')document.documentElement.classList.add('fi-done')}catch(e){}",
          }}
        />
      </head>
      <body>
        <FootballIntro />
        {/* Stadium backdrop: pitch stripes, halfway line + centre circle, floodlights */}
        <div className="stadium" aria-hidden="true">
          <div className="stadium-stripes" />
          <svg className="pitch-lines" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
            <line x1="500" y1="0" x2="500" y2="600" />
            <circle cx="500" cy="300" r="120" />
            <circle cx="500" cy="300" r="4" fill="currentColor" stroke="none" />
            <rect x="-2" y="140" width="130" height="320" />
            <rect x="872" y="140" width="130" height="320" />
          </svg>
          <div className="floodlight floodlight-left" />
          <div className="floodlight floodlight-right" />
        </div>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
