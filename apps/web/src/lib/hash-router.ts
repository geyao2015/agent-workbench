import { useEffect, useState } from "react";

export type AppView = "chat" | "releases";

export interface AppRoute {
  view: AppView;
  threadId?: string;
  runId?: string;
}

export function parseRoute(hash: string): AppRoute {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const segments = (path ?? "").split("/").filter(Boolean);

  if (segments[0] === "releases") {
    const params = new URLSearchParams(query ?? "");

    return {
      view: "releases",
      threadId: segments[1],
      runId: params.get("run") ?? undefined,
    };
  }

  return { view: "chat" };
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));

    window.addEventListener("hashchange", onChange);

    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
