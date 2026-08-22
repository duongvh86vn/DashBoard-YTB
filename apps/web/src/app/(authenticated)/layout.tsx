import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell";
import { AuthGate } from "../../components/auth-gate";

export default function AuthenticatedLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
