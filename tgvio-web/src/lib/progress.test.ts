// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./api", () => ({ ...api, apiUrl: (path: string) => path, authHeaders: () => ({}) }));

type ProgressModule = typeof import("./progress");
type Reply = { items: Record<string, { time: number; duration: number; at: number }> };
const privateEntry = { time: 120, duration: 3600, at: 9999999999999 };
const empty = { items: {} };
let progress: ProgressModule;

function deferred() {
  let resolve!: (reply: Reply) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Reply>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  // Drain the flush -> pull chain and its request continuations.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function signIn(account = "A") {
  progress.syncProgress(account);
  await settle();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  api.get.mockReset().mockResolvedValue(empty);
  api.post.mockReset().mockResolvedValue(empty);
  progress = await import("./progress");
});

afterEach(() => {
  progress.syncProgress(null);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("account-owned progress", () => {
  it("drops A's local copy, queued upload and timer on logout before B signs in", async () => {
    await signIn();
    progress.saveProgress("/private-A.mkv", 120, 3600);
    progress.syncProgress(null);
    expect(progress.recentProgress()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await signIn("B");
    await vi.advanceTimersByTimeAsync(5000);
    window.dispatchEvent(new Event("pagehide"));
    expect(api.post.mock.calls).toEqual([]);
    expect(progress.getProgress("/private-A.mkv")).toBeUndefined();
  });

  it("drops A's queued upload when switching directly to B", async () => {
    await signIn();
    progress.saveProgress("/private-A.mkv", 120, 3600);
    await signIn("B");
    expect(api.post.mock.calls).toEqual([]);
    expect(progress.recentProgress()).toEqual([]);
  });

  it.each([null, "B"])("ignores a stale A pull after switching to %s", async next => {
    const old = deferred();
    api.get.mockReturnValueOnce(old.promise);
    await signIn();
    progress.syncProgress(next);
    await settle();
    old.resolve({ items: { "/private-A.mkv": privateEntry } });
    await settle();
    expect(progress.getProgress("/private-A.mkv")).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("tgvio-web:progress") ?? "{}")).toEqual({});
  });

  it.each(["success", "failure"])("ignores a stale A upload %s after B signs in", async outcome => {
    await signIn();
    const old = deferred();
    api.post.mockReturnValueOnce(old.promise);
    progress.saveProgress("/private-A.mkv", 120, 3600);
    // A repeated sync flushes immediately, then normally starts a pull.
    await signIn();
    await signIn("B");
    const pulls = api.get.mock.calls.length;
    if (outcome === "success") old.resolve({ items: { "/private-A.mkv": privateEntry } });
    else old.reject(new Error("offline"));
    await settle();
    expect(progress.getProgress("/private-A.mkv")).toBeUndefined();
    expect(api.get.mock.calls.length).toBe(pulls);
    progress.saveProgress("/B.mkv", 300, 3600);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: {
      "/B.mkv": { time: 300, duration: 3600, at: expect.any(Number) },
    } });
  });

  it("rejects replies from an earlier session even when A signs back in", async () => {
    const old = deferred();
    api.get.mockReturnValueOnce(old.promise);
    await signIn();
    progress.syncProgress(null);
    await signIn();
    old.resolve({ items: { "/old-session.mkv": privateEntry } });
    await settle();
    expect(progress.getProgress("/old-session.mkv")).toBeUndefined();
  });

  it("does not migrate progress recorded while signed out after A logs out", async () => {
    await signIn();
    progress.syncProgress(null);
    progress.saveProgress("/guest.mkv", 120, 3600);
    await signIn();
    expect(progress.recentProgress()).toEqual([]);
    expect(api.post.mock.calls).toEqual([]);
  });

  it("keeps pending progress when syncing the same account again", async () => {
    await signIn();
    progress.saveProgress("/A.mkv", 120, 3600);
    await signIn();
    expect(progress.getProgress("/A.mkv")?.time).toBe(120);
    expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: {
      "/A.mkv": { time: 120, duration: 3600, at: expect.any(Number) },
    } });
  });

  it("merges current-account server updates from pulls and upload replies", async () => {
    api.get.mockResolvedValueOnce({ items: { "/phone.mkv": privateEntry } });
    await signIn();
    expect(progress.getProgress("/phone.mkv")).toEqual(privateEntry);
    api.post.mockResolvedValueOnce({ items: { "/laptop.mkv": privateEntry } });
    progress.saveProgress("/current.mkv", 300, 3600);
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress.getProgress("/laptop.mkv")).toEqual(privateEntry);
    expect(progress.getProgress("/current.mkv")?.time).toBe(300);
  });

  it("keeps undo usable within the same account", async () => {
    await signIn();
    progress.saveProgress("/A.mkv", 120, 3600);
    const undo = progress.clearProgress(["/A.mkv"]);
    expect(progress.recentProgress()).toEqual([]);
    undo();
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress.getProgress("/A.mkv")?.time).toBe(120);
    expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: {
      "/A.mkv": { time: 120, duration: 3600, at: expect.any(Number) },
    } });
  });

  it("retries same-account offline progress with the next change", async () => {
    await signIn();
    api.post.mockRejectedValueOnce(new Error("offline"));
    progress.saveProgress("/first.mkv", 120, 3600);
    await vi.advanceTimersByTimeAsync(5000);
    progress.saveProgress("/second.mkv", 300, 3600);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: {
      "/first.mkv": { time: 120, duration: 3600, at: expect.any(Number) },
      "/second.mkv": { time: 300, duration: 3600, at: expect.any(Number) },
    } });
    expect(progress.recentProgress()).toHaveLength(2);
  });

  it("migrates legacy browser progress after the initial signed-out startup", async () => {
    localStorage.setItem("tgvio-web:progress", JSON.stringify({ "/legacy.mkv": privateEntry }));
    vi.resetModules();
    progress = await import("./progress");
    progress.syncProgress(null);
    await signIn();
    expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: { "/legacy.mkv": privateEntry } });
    expect(progress.getProgress("/legacy.mkv")).toEqual(privateEntry);
  });

  it("keeps an existing owner's offline copy on the first same-account startup", async () => {
    localStorage.setItem("tgvio-web:progress", JSON.stringify({ "/offline.mkv": privateEntry }));
    localStorage.setItem("tgvio-web:progress-owner", "A");
    vi.resetModules();
    progress = await import("./progress");
    progress.syncProgress(null);
    await signIn();
    expect(progress.getProgress("/offline.mkv")).toEqual(privateEntry);
  });

  it("does not let A's delayed undo restore entries into B", async () => {
    await signIn();
    progress.saveProgress("/private-A.mkv", 120, 3600);
    const undo = progress.clearProgress(["/private-A.mkv"]);
    await signIn("B");
    undo();
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress.recentProgress()).toEqual([]);
    expect(api.post.mock.calls).toEqual([]);
  });
});
