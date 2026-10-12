import { create } from "zustand";
import * as auth from "../api/auth";
import { applyTouchIcon } from "../lib/brand";
import { onUnauthorized, setToken } from "../lib/api";
import type { Me, Settings } from "../lib/types";

type Status = "loading" | "ready" | "login" | "error";

interface SessionState {
  status: Status;
  me: Me | null;
  settings: Settings;
  error: string;
  boot: () => Promise<void>;
  signIn: (username: string, password: string, otp: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set, getState) => ({
  status: "loading",
  me: null,
  settings: {},
  error: "",
  async boot() {
    try {
      const settings = await auth.publicSettings().catch(() => ({} as Settings));
      set({ settings });
      if (settings.site_title) document.title = settings.site_title;
      void applyTouchIcon(settings);
      const me = await auth.me();
      set({ me, status: "ready", error: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (getState().status === "login") return; // the 401 handler already moved us
      set({ status: "login", me: null, error: /401|登录|token/i.test(message) ? "" : message });
    }
  },
  async signIn(username, password, otp) {
    const token = await auth.login(username, password, otp);
    setToken(token);
    const me = await auth.me();
    set({ me, status: "ready", error: "" });
  },
  async signOut() {
    await auth.logout();
    setToken("");
    set({ me: null, status: "login" });
  },
}));

onUnauthorized(() => {
  setToken("");
  useSession.setState({ status: "login", me: null });
});
