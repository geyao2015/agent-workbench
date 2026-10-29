import type { AppRoute } from "@/lib/hash-router";

import { ReleaseDetailView } from "./ReleaseDetailView";
import { ReleaseListView } from "./ReleaseListView";

export function ReleaseWorkspace({ route }: { route: AppRoute }) {
  if (!route.threadId) {
    return <ReleaseListView />;
  }

  return (
    <ReleaseDetailView
      key={`${route.threadId}:${route.runId ?? ""}`}
      threadId={route.threadId}
      runId={route.runId}
    />
  );
}
