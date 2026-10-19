import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Tracker",
  description: "Your watchlist and technical charts, in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
