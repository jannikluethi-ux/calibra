import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col md:flex-row bg-surface-0 text-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <StatusBar />
        <CommandPalette />
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-5 pb-24 sm:px-6 md:pb-6">
          <div className="mx-auto w-full max-w-[1280px]">
            {children}
            <footer className="mt-12 border-t border-line pt-4 text-caption text-ink-3 max-w-3xl">
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
