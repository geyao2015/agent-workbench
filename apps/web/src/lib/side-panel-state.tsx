import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SidePanelName = "events" | "notes";

interface SidePanelState {
  activePanel: SidePanelName | null;
  togglePanel: (panel: SidePanelName) => void;
  closePanel: () => void;
}

const SidePanelContext = createContext<SidePanelState | null>(null);

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [activePanel, setActivePanel] = useState<SidePanelName | null>(null);
  const value = useMemo<SidePanelState>(
    () => ({
      activePanel,
      togglePanel: (panel) =>
        setActivePanel((current) => (current === panel ? null : panel)),
      closePanel: () => setActivePanel(null),
    }),
    [activePanel],
  );

  return (
    <SidePanelContext.Provider value={value}>
      {children}
    </SidePanelContext.Provider>
  );
}

export function useSidePanel(): SidePanelState {
  const value = useContext(SidePanelContext);

  if (!value) {
    throw new Error("useSidePanel must be used within SidePanelProvider");
  }

  return value;
}
