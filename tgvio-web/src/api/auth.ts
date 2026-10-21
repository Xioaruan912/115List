import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ApiError, apiUrl, authHeaders, get, post } from "../lib/api";
import type { ApiResponse, Me, Settings } from "../lib/types";

const SALT = "https://github.com/alist-org/alist";

export function hashPassword(password: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${password}-${SALT}`)));
}

/** Login does its own error handling: a 401 here means a wrong password, not an expired session. */
export async function login(username: string, password: string, otp: string): Promise<string> {
  const response = await fetch(apiUrl("/auth/login/hash"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: hashPassword(password), otp_code: otp }),
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
