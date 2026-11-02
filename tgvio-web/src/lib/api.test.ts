// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, onUnauthorized, post, setToken } from "./api";

const unauthorized = vi.fn();

beforeEach(() => {
  localStorage.clear();
  unauthorized.mockReset();
  onUnauthorized(unauthorized);
});
afterEach(() => vi.unstubAllGlobals());

describe("request session", () => {
  it.each([{ name: "GET", request: get }, { name: "POST", request: post }])("ignores an old token's late 401 for $name", async ({ request }) => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    setToken("A");
    const response = request("/old").catch(error => error);
    setToken("B");
    resolve(Response.json({ code: 401, message: "expired", data: null }));
    await expect(response).resolves.toMatchObject({ code: 401 });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it.each([{ name: "GET", request: get }, { name: "POST", request: post }])("still handles the current token's 401 for $name", async ({ request }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 401, message: "expired", data: null })));
    setToken("A");
    await expect(request("/current")).rejects.toMatchObject({ code: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
