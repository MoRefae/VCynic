import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "VCynic | Pitch intelligence",
  description: "Multi-agent pitch intelligence for founders.",
  icons: { icon: "/icon.svg" },
  // Tells the Dark Reader extension to leave this page alone. VCynic is a
  // light-only design, and Dark Reader's inversion both breaks the palette and
  // injects data-darkreader-* attributes on <html> before React hydrates.
  other: { "darkreader-lock": "true" },
};
export const viewport: Viewport = { colorScheme: "light" };
export default function RootLayout({children}:{children:React.ReactNode}) {
  // suppressHydrationWarning: browser extensions (Dark Reader, Grammarly, ...)
  // mutate <html> attributes before hydration. Only this element is exempt.
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
