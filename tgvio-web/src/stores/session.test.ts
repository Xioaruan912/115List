// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../lib/types";

type ProgressModule = typeof import("../lib/progress");
type SessionModule = typeof import("./session");
const users: Record<string, Me> = {
  A: { id: 1, username: "A", base_path: "/", role: 0, disabled: false, permission: 0, otp: false },
  B: { id: 2, username: "B", base_path: "/", role: 0, disabled: false, permission: 0, otp: false },
  "": { id: 3, username: "guest", base_path: "/", role: 1, disabled: false, permission: 0, otp: false },
};
let progress: ProgressModule;
let session: SessionModule;
let delayedMe: Promise<Response> | undefined;
let delayedLogout: Promise<Response> | undefined;
let sends: { token: string; items: Record<string, unknown> }[];

function reply(data: unknown, code = 200) {
  return Response.json({ code, message: "", data });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("token", "A");
  delayedMe = undefined;
  delayedLogout = undefined;
  sends = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const token = (options?.headers as Record<string, string> | undefined)?.Authorization ?? "";
    if (url.endsWith("/public/settings")) return reply({ logo: "https://example.test/logo.png" });
    if (url.endsWith("/auth/login/hash")) return reply({ token: "B" });
    if (url.endsWith("/auth/logout")) return delayedLogout ?? reply(null);
    if (url.endsWith("/me")) return delayedMe ?? reply(users[token]);
    if (url.endsWith("/expired")) return reply(null, 401);
    if (url.endsWith("/tgvio/progress")) {
      if (options?.method === "POST") sends.push({ token, ...JSON.parse(options.body as string) });
      return reply({ items: {} });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  progress = await import("../lib/progress");
  session = await import("./session");
});

afterEach(() => {
  progress.syncProgress(null);
  vi.unstubAllGlobals();
});

async function signedInAsA() {
  await session.useSession.getState().boot();
  // Model the existing App effect as well; subsequent transitions get no React effect.
  progress.syncProgress("1:A");
  progress.saveProgress("/private-A.mkv", 120, 3600);
}

describe("session progress boundary", () => {
  it("stops A's pending upload before installing B's token and starts B after /me", async () => {
    await signedInAsA();
    const me = deferred();
    delayedMe = me.promise;
    const signingIn = session.useSession.getState().signIn("B", "password", "");
    await vi.waitFor(() => expect(localStorage.getItem("token")).toBe("B"));
    window.dispatchEvent(new Event("pagehide"));
    expect(sends).toEqual([]);
    expect(progress.recentProgress()).toEqual([]);
    me.resolve(reply(users.B));
    await signingIn;
    progress.saveProgress("/B.mkv", 300, 3600);
    window.dispatchEvent(new Event("pagehide"));
    expect(sends).toEqual([{ token: "B", items: { "/B.mkv": {
      time: 300, duration: 3600, at: expect.any(Number),
    } } }]);
  });

  it("stops progress synchronously when sign-out starts", async () => {
    await signedInAsA();
    const logout = deferred();
    delayedLogout = logout.promise;
    const signingOut = session.useSession.getState().signOut();
    expect(progress.recentProgress()).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(sends).toEqual([]);
    logout.resolve(reply(null));
    await signingOut;
  });

  it("stops A's progress before switching to guest credentials", async () => {
    await signedInAsA();
    await session.useSession.getState().browseAsGuest();
    window.dispatchEvent(new Event("pagehide"));
    expect(sends).toEqual([]);
    expect(progress.recentProgress()).toEqual([]);
  });

  it("clears progress immediately when the current session expires", async () => {
    await signedInAsA();
    const { get } = await import("../lib/api");
    await expect(get("/expired")).rejects.toMatchObject({ code: 401 });
    expect(progress.recentProgress()).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(sends).toEqual([]);
  });

  it("does not let a late logout response clear a newer B session", async () => {
    await signedInAsA();
    const logout = deferred();
    delayedLogout = logout.promise;
    const signingOut = session.useSession.getState().signOut();
    await session.useSession.getState().signIn("B", "password", "");
    logout.resolve(reply(null));
    await signingOut;
    expect(localStorage.getItem("token")).toBe("B");
    expect(session.useSession.getState().me?.username).toBe("B");
  });

  it("does not let an earlier boot's /me response replace B", async () => {
    const old = deferred();
    delayedMe = old.promise;
    const booting = session.useSession.getState().boot();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/me", expect.anything()));
    delayedMe = undefined;
    await session.useSession.getState().signIn("B", "password", "");
    progress.saveProgress("/B.mkv", 300, 3600);
    old.resolve(reply(users.A));
    await booting;
    expect(session.useSession.getState().me?.username).toBe("B");
    expect(progress.getProgress("/B.mkv")?.time).toBe(300);
  });

  it("migrates the initial legacy browser copy during boot", async () => {
    const entry = { time: 120, duration: 3600, at: 100 };
    localStorage.setItem("tgvio-web:progress", JSON.stringify({ "/legacy.mkv": entry }));
    vi.resetModules();
    progress = await import("../lib/progress");
    session = await import("./session");
    progress.syncProgress(null);
    await session.useSession.getState().boot();
    expect(sends).toEqual([{ token: "A", items: { "/legacy.mkv": entry } }]);
  });
});
