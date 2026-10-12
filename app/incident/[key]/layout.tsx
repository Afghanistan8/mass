import type { Metadata } from "next";
import type { ReactNode } from "react";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  let name = key;
  try { name = decodeURIComponent(key); } catch { /* keep the raw segment */ }
  return { title: `Incident ${name.slice(0, 60)}` };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
