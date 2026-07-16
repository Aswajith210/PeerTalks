import { create } from "zustand";

interface AuthState {
  userId: string | null;
  setUserId: (id: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  setUserId: (userId) => set({ userId }),
}));
