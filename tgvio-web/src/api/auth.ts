import { ApiError, apiUrl, authHeaders, get, post } from "../lib/api";
import type { ApiResponse, Me, Settings } from "../lib/types";

const SALT = "https://github.com/alist-org/alist";

/** The password as the server's hashed login takes it (the hash library loads at sign-in only). */
export async function hashPassword(password: string): Promise<string> {
  const [{ sha256 }, { bytesToHex, utf8ToBytes }] = await Promise.all([import("@noble/hashes/sha2.js"), import("@noble/hashes/utils.js")]);
  return bytesToHex(sha256(utf8ToBytes(`${password}-${SALT}`)));
}

/** Login does its own error handling: a 401 here means a wrong password, not an expired session. */
export async function login(username: string, password: string, otp: string): Promise<string> {
  const response = await fetch(apiUrl("/auth/login/hash"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: await hashPassword(password), otp_code: otp }),
  });
  const body = await response.json() as ApiResponse<{ token: string }>;
  if (body.code !== 200) throw new ApiError(body.code, body.message);
  return body.data.token;
}

export const me = () => get<Me>("/me");
export const publicSettings = () => get<Settings>("/public/settings");
export const logout = () => get<null>("/auth/logout").catch(() => null);

export function updateMe(body: { username: string; password: string }): Promise<null> {
  return post("/me/update", body);
}

export { authHeaders };
