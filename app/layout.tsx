import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Mass — emergency authority that cannot self-certify", template: "%s · Mass" },
  description: "Pre-committed emergency charters. GenLayer validators assess evidence. Finality-gated, single-use, expiring capabilities. No admin pause bypass.",
};

export const viewport: Viewport = { themeColor: "#07090b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
