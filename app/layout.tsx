import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Livo Pronunciation Agent",
  description: "AI pronunciation scoring for 30-45 second English speech samples."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
