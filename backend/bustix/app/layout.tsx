import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BusTix Backend API",
  description: "BusTix Ticketing Backend Service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-full flex flex-col font-sans antialiased">{children}</body>
    </html>
  );
}
