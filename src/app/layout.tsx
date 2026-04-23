import type { Metadata, Viewport } from "next";
import { EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { WebVitals } from "@/lib/axiom/client";

const ebGaramond = EB_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
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

// Default app-wide metadata. The marketing home at `/` provides its own
// richer metadata (title + OG + twitter) that overrides these defaults; app
// routes (/home, /login, /skills/…) fall through to these.
//
// `metadataBase` resolves relative OG/Twitter image URLs to absolute URLs
// in the rendered <meta> tags. Vercel injects `VERCEL_PROJECT_PRODUCTION_URL`
// on production deployments; fall back to localhost for dev so the build
// doesn't warn. Preview deploys will resolve to localhost in the tags but
// that's acceptable — previews aren't shared on social.
const metadataBase = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  : new URL("http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
  title: "Tatara",
  description: "Your company's brain.",
};

// Viewport + theme-color hints for mobile browser chrome. `userScalable: true`
// is intentional — pinch-zoom is an accessibility requirement. Theme colors
// resolve the `--surface-0` token for each scheme (cream in light, indigo-deep
// in dark) so the browser chrome matches the app surface.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EAD8" },
    { media: "(prefers-color-scheme: dark)", color: "#1F2A3F" },
  ],
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
      className={`${ebGaramond.variable} ${inter.variable} ${jetbrains.variable} h-full antialiased ${theme === "dark" ? "dark" : ""}`}
    >
      <WebVitals />
      <head>
        <style>{`:root { --sidebar-width: 280px; }`}</style>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
