import { create } from "zustand";

import {
  fetchRuntimeInfo,
  switchRuntime,
  type RuntimeInfo,
} from "@/transport/sse";

export interface PendingSwitch {
  mode: "agent" | "mock";
  modelId?: string;
}

interface RuntimeStore {
  info: RuntimeInfo | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  switching: boolean;
  pending: PendingSwitch | null;
  chatBusy: boolean;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  requestSwitch(input: PendingSwitch): Promise<void>;
  setChatBusy(busy: boolean): void;
}

const CHANNEL_NAME = "agent-workbench:runtime";

let inflight: Promise<void> | null = null;
let initialized = false;
let channel: BroadcastChannel | null = null;

function broadcast(version: number | undefined) {
  channel?.postMessage({ version });
}

export const useRuntimeStore = create<RuntimeStore>()((set, get) => {
  async function load(): Promise<void> {
    if (inflight) {
      return inflight;
    }

    inflight = (async () => {
      try {
        const info = await fetchRuntimeInfo();
        set({ info, status: "ready", error: null });
      } catch (cause) {
        set({
          status: "error",
          error: cause instanceof Error ? cause.message : "读取运行时信息失败",
        });
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  async function applySwitch(input: PendingSwitch): Promise<void> {
    set({ switching: true, error: null, pending: null });

    try {
      const info = await switchRuntime(input);
      set({ info, status: "ready", switching: false });
      broadcast(info.version);
    } catch (cause) {
      set({
        switching: false,
        error: cause instanceof Error ? cause.message : "切换运行时失败",
      });
    }
  }

  return {
    info: null,
    status: "loading",
    error: null,
    switching: false,
    pending: null,
    chatBusy: false,

    async initialize() {
      await load();

      if (initialized || typeof window === "undefined") {
        return;
      }

      initialized = true;

      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event: MessageEvent<{ version?: number }>) => {
          if (event.data?.version !== get().info?.version) {
            void get().refresh();
          }
        };
      }

      window.addEventListener("focus", () => {
        if (document.visibilityState === "visible") {
          void get().refresh();
        }
      });
    },

    async refresh() {
      await load();
    },

    async requestSwitch(input) {
      if (get().switching) {
        return;
      }

      if (get().chatBusy) {
        set({ pending: input, error: null });
        return;
      }

      await applySwitch(input);
    },

    setChatBusy(busy) {
      const wasBusy = get().chatBusy;

      set({ chatBusy: busy });

      if (wasBusy && !busy && get().pending) {
        void applySwitch(get().pending as PendingSwitch);
      }
    },
  };
});
