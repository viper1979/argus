import { Eye } from 'lucide-react';
import { useAppInfo } from '@renderer/hooks/use-app-info';

/** Left navigation column; will list projects and their tasks. */
export function Sidebar(): React.JSX.Element {
  const appInfo = useAppInfo();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <header className="flex items-center gap-2 px-4 py-3 font-semibold">
        <Eye className="size-4" aria-hidden />
        Argus
      </header>
      <nav className="flex-1 px-4 py-2 text-sm text-muted-foreground">Noch keine Projekte</nav>
      <footer className="px-4 py-2 text-xs text-muted-foreground">
        {appInfo ? `Version ${appInfo.version}` : ' '}
      </footer>
    </aside>
  );
}
