import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex bg-terminal-bg text-terminal-text overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar />
        <main className="flex-1 overflow-y-auto p-3">{children}</main>
      </div>
    </div>
  );
}
