import { Suspense, useEffect, useState, type ReactNode } from "react";

/** Load on first use, then keep mounted so closing a dialog/tab preserves state. */
export function DeferredDashboardContent({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [hasOpened, setHasOpened] = useState(active);
  useEffect(() => {
    if (active) setHasOpened(true);
  }, [active]);

  if (!active && !hasOpened) return null;
  return <Suspense fallback={active ? <DashboardLoading /> : null}>{children}</Suspense>;
}

export function DashboardLoading() {
  return <div role="status" className="p-6 text-center text-muted-foreground">Memuat fitur dashboard…</div>;
}
