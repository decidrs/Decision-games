import type { ReactNode } from "react";
import { config } from "../lib/config";

export const metadata = { title: `${config.gameName} by ${config.studioName}` };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "0 auto", padding: "24px 16px", color: "#1b2333", background: "#fafafa" }}>
        <header style={{ marginBottom: 24 }}>
          <strong>{config.gameName}</strong> <span style={{ color: "#667" }}>by {config.studioName}</span>
          <div style={{ fontSize: 12, color: "#a33" }}>Test build. Synthetic data only.</div>
        </header>
        {children}
      </body>
    </html>
  );
}
