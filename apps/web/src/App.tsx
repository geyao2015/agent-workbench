import { useHashRoute } from "@/lib/hash-router";
import { SidePanelProvider } from "@/lib/side-panel-state";
import { ChatView } from "@/views/ChatView";
import { ReleaseWorkspace } from "@/views/ReleaseWorkspace";

export default function App() {
  const route = useHashRoute();

  return (
    <SidePanelProvider>
      {route.view === "releases" ? (
        <ReleaseWorkspace route={route} />
      ) : (
        <ChatView />
      )}
    </SidePanelProvider>
  );
}
