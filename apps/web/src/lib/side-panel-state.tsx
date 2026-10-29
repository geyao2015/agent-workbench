import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SidePanelName = "events" | "notes" | "performance";

const CLOSE_MS = 320;

interface SidePanelState {
  activePanel: SidePanelName | null;
  closing: boolean;
  instantOpen: boolean;
  togglePanel: (panel: SidePanelName) => void;
  closePanel: () => void;
}

const SidePanelContext = createContext<SidePanelState | null>(null);

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [activePanel, setActivePanel] = useState<SidePanelName | null>(null);
  const [closing, setClosing] = useState(false);
  const [instantOpen, setInstantOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activePanel !== null || closing) {
      return;
    }

    const trigger = triggerRef.current;

    if (trigger?.isConnected) {
      trigger.focus();
    }

    triggerRef.current = null;
  }, [activePanel, closing]);

  function closePanel() {
    if (!activePanel || closing) {
      return;
    }

    setClosing(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setActivePanel(null);
      setClosing(false);
      timerRef.current = null;
    }, CLOSE_MS);
  }

  function togglePanel(panel: SidePanelName) {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (activePanel === panel) {
      if (closing) {
        setClosing(false);
      } else {
        closePanel();
      }

      return;
    }

    if (activePanel === null && !closing) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }

    setInstantOpen(activePanel !== null);
    setClosing(false);
    setActivePanel(panel);
  }

  const value = useMemo<SidePanelState>(
    () => ({
      activePanel,
      closing,
      instantOpen,
      togglePanel,
      closePanel,
    }),
    [activePanel, closing, instantOpen],
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
