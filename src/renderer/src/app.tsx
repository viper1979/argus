import { Sidebar } from './components/layout/sidebar';

/**
 * Root layout: sidebar on the left, content area on the right.
 * The content area stays empty until tasks can be opened.
 */
export function App(): React.JSX.Element {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Kein Task ausgewählt
      </main>
    </div>
  );
}
