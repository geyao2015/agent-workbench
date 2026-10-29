import { lazy, Suspense } from "react";

import { Loader2 } from "lucide-react";

import { useHashRoute } from "@/lib/hash-router";
import { SidePanelProvider } from "@/lib/side-panel-state";
import { ChatView } from "@/views/ChatView";

const ReleaseWorkspace = lazy(() =>
  import("@/views/ReleaseWorkspace").then((module) => ({
    default: module.ReleaseWorkspace,
  })),
);

function ReleaseFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-muted/20">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载 Release 工作台…
      </div>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();

  return (
    <SidePanelProvider>
      {route.view === "releases" ? (
        <Suspense fallback={<ReleaseFallback />}>
          <ReleaseWorkspace route={route} />
        </Suspense>
      ) : (
        <ChatView />
      )}
    </SidePanelProvider>
  );
}
