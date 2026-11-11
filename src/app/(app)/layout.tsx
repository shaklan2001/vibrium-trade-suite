import { AppShell } from "@/components/layout/app-shell";
import { FloatingCopilot } from "@/components/copilot/copilot-panel";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      {children}
      <FloatingCopilot />
    </AppShell>
  );
}
