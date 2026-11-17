import { useEffect, useState } from "react";
import { Badge, Button, Loader } from "./cyac";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { useStore } from "./store";

function Errors() {
  const errors = useStore((s) => s.errors);
  if (!errors.length) return null;
  return (
    <div className="toasts" role="alert">
      {errors.map((e) => (
        <div key={e.id} className="toast">
          <Badge tone="alert" />
          <span>{e.message}</span>
        </div>
      ))}
    </div>
  );
}

function Splash() {
  const threads = useStore((s) => s.threads);
  return (
    <main className="thread thread--empty">
      <div className="splash">
        <span className="splash__mark">PI</span>
        <span className="splash__caption">[EVERYTHING RUNS ON CYBERACME]</span>
        <span className="splash__sub">
          {threads.length ? "Pick a thread, or start a new one." : "Start a thread to begin."}
        </span>
      </div>
    </main>
  );
}

export function App() {
  const current = useStore((s) => s.current);
  const connected = useStore((s) => s.connected);
  const everConnected = useStore((s) => s.everConnected);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const title = useStore.getState().threads.find((t) => t.id === current)?.title;
    document.title = title ? `${title} · pi` : "pi · CyAc";
  }, [current]);

  if (!everConnected) {
    return (
      <div className="boot">
        <Loader label="Linking" />
      </div>
    );
  }

  return (
    <div className={`app${navOpen ? " app--nav-open" : ""}`}>
      <Sidebar onPicked={() => setNavOpen(false)} />
      <div className="app__main">
        <div className="mobile-bar">
          <Button size="s" variant="ghost" onClick={() => setNavOpen((v) => !v)} aria-expanded={navOpen}>
            Threads
          </Button>
          <span className="wordmark wordmark--s">CyAc</span>
        </div>
        {!connected && (
          <div className="offline" role="status">
            <Badge tone="caution" dot>
              Link lost
            </Badge>
            <span>Reconnecting to the server.</span>
          </div>
        )}
        {current ? <ThreadView key={current} threadId={current} /> : <Splash />}
      </div>
      <Errors />
    </div>
  );
}
