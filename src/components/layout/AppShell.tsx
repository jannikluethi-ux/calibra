import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col md:flex-row bg-terminal-bg text-terminal-text overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <StatusBar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5">
          <div className="mx-auto w-full max-w-[1180px]">
            {children}
            <footer className="mt-8 border-t border-terminal-border pt-3 text-[11px] text-terminal-muted">
              Calibra is probabilistic market intelligence, not investment advice. Probabilities and downside
              figures are scenario weights, not buy or sell recommendations. Data comes from third-party sources
              and may be delayed or incomplete. See <a className="underline" href="/methodology">methodology</a>.
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
