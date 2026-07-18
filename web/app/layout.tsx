import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofCast — every sentence has a receipt",
  description:
    "AI matchday recaps generated from cryptographically verified TxLINE match data, narrated aloud, with on-chain proof links for every fact.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#06150c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
      </body>
    </html>
  );
}
