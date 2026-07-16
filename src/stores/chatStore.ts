import { create } from "zustand";

interface ChatState {
  sessionId: string | null;
  status: "idle" | "matching" | "connected" | "ended";
  mode: "random" | "interest" | "private_room" | null;
  setSessionId: (id: string | null) => void;
  setStatus: (status: ChatState["status"]) => void;
  setMode: (mode: ChatState["mode"]) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  status: "idle",
  mode: null,
  setSessionId: (sessionId) => set({ sessionId }),
  setStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),
  reset: () => set({ sessionId: null, status: "idle", mode: null }),
}));
