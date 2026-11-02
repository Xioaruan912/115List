import { apiBase } from "./config";
import type { ApiResponse } from "./types";

const TOKEN_KEY = "token"; // the same key the official front end uses

export class ApiError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

let unauthorized: () => void = () => undefined;

export function onUnauthorized(handler: () => void): void {
  unauthorized = handler;
}

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: the session still works until reload */ }
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: token, ...extra } : extra;
}

type Query = Record<string, string | number | boolean | undefined>;

function url(path: string, query?: Query): string {
  const out = `${apiBase}/api${path}`;
  if (!query) return out;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `${out}?${text}` : out;
}

async function parse<T>(response: Response, requestToken: string): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = await response.json() as ApiResponse<T>;
  } catch {
    throw new ApiError(response.status, `服务器返回 ${response.status}`);
  }
  if (body.code === 401) {
    if (getToken() === requestToken) unauthorized();
    throw new ApiError(401, body.message || "请重新登录");
  }
  if (body.code !== 200) throw new ApiError(body.code, body.message || `请求失败 (${body.code})`);
  return body.data;
}

export async function get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const headers = authHeaders();
  return parse<T>(await fetch(url(path, query), { headers, signal }), headers.Authorization ?? "");
}

export async function post<T>(path: string, body?: unknown, query?: Query, signal?: AbortSignal): Promise<T> {
  const headers = authHeaders({ "Content-Type": "application/json" });
  return parse<T>(await fetch(url(path, query), {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  }), headers.Authorization ?? "");
}

export { url as apiUrl };
