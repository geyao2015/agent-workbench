import { useHashRoute } from "@/lib/hash-router";
import { ChatView } from "@/views/ChatView";
import { ReleaseWorkspace } from "@/views/ReleaseWorkspace";

export default function App() {
  const route = useHashRoute();

  return route.view === "releases" ? (
    <ReleaseWorkspace route={route} />
  ) : (
    <ChatView />
  );
}
