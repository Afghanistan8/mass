import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Command · live authority" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
