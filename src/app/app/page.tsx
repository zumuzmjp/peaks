import { Suspense } from "react";
import type { Metadata } from "next";
import { PeaksApp } from "@/components/PeaksApp";

export const metadata: Metadata = { title: "App" };

export default function AppPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <PeaksApp />
    </Suspense>
  );
}
