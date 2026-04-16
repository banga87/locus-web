import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { WebVitals } from "@/lib/axiom/client";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Locus",
  description: "Your company's brain.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("locus-theme")?.value === "dark" ? "dark" : "light";
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable} h-full antialiased ${theme === "dark" ? "dark" : ""}`}
    >
      <WebVitals />
      <head>
        <style>{`:root { --sidebar-width: 280px; }`}</style>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
