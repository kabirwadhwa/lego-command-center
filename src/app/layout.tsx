import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEGO Command Center",
  description: "Single operational command center for LEGO resellers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full font-sans antialiased">
      <body className="min-h-full flex flex-col text-slate-900 bg-slate-50 dark:text-slate-50 dark:bg-slate-950">
        {children}
      </body>
    </html>
  );
}
