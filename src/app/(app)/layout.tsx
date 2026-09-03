import { AppShell } from "@/components/layout/app-shell";
import { FloatingCopilot } from "@/components/copilot/copilot-panel";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="p-6 md:p-8">{children}</div>
      <FloatingCopilot />
    </AppShell>
  );
}
