import { useEffect, useRef } from "react";

import { useHashRoute, type AppView } from "@/lib/hash-router";
import { SidePanelProvider } from "@/lib/side-panel-state";
import { cn } from "@/lib/utils";
import { ChatView } from "@/views/ChatView";
import { ReleaseWorkspace } from "@/views/ReleaseWorkspace";

export default function App() {
  const route = useHashRoute();
  const previousView = useRef<AppView | null>(null);
  const direction =
    previousView.current === null
      ? null
      : route.view === "releases"
        ? "forward"
        : "backward";

  useEffect(() => {
    previousView.current = route.view;
  }, [route.view]);

  return (
    <SidePanelProvider>
      <div
        key={route.view}
        className={cn(
          "h-screen overflow-hidden",
          direction === "forward" && "view-enter-forward",
          direction === "backward" && "view-enter-backward",
        )}
      >
        {route.view === "releases" ? (
          <ReleaseWorkspace route={route} />
        ) : (
          <ChatView />
        )}
      </div>
    </SidePanelProvider>
  );
}
