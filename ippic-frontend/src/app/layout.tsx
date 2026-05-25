import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "i-PPIC PRO | CV Sandy Graphia",
  description: "Production Planning Control Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}