import { apiUrl, authHeaders } from "./api";
import type { ApiResponse, UploadSnapshot } from "./types";

/**
 * Two ways in. Small files go up in one PUT /api/fs/put. Large files use the
 * resumable multipart API when the site enables it: the file is cut into chunks,
 * sent a few at a time, each chunk retried on its own, and a dropped connection
 * resumes from what the server already holds. In both cases the browser only
 * waits for OpenList to receive the bytes; the push to the drive is reported
 * separately (an upload task, or the session's storage_progress).
 */

export interface UploadProgress {
  phase: "sending" | "storing";
  sent: number;
  total: number;
  storage?: number; // 0..100 while the server writes to the drive
}

export interface UploadOptions {
  path: string; // full destination path including the file name
  file: Blob & { lastModified?: number };
  overwrite: boolean;
  multipart: boolean;
  onProgress: (progress: UploadProgress) => void;
  signal: AbortSignal;
}

const MULTIPART_MIN = 16 * 1024 * 1024;
const PARALLEL = 3;

export class UploadError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

interface XhrResult<T> { code: number; message: string; data: T }

function xhr<T>(method: string, url: string, headers: Record<string, string>, body: XMLHttpRequestBodyInit | null,
  signal: AbortSignal, onSent?: (loaded: number) => void): Promise<XhrResult<T>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
    if (onSent) request.upload.onprogress = event => onSent(event.loaded);
    request.onload = () => {
      try {
        resolve(JSON.parse(request.responseText) as ApiResponse<T>);
      } catch {
        resolve({ code: request.status || 0, message: `HTTP ${request.status}`, data: undefined as T });
      }
    };
    request.onerror = () => reject(new UploadError(0, "网络中断"));
    request.ontimeout = () => reject(new UploadError(0, "请求超时"));
    const abort = (): void => request.abort();
    request.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.send(body);
  });
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});

function baseHeaders(options: UploadOptions): Record<string, string> {
  const headers = authHeaders({
    "File-Path": encodeURIComponent(options.path),
    "Overwrite": options.overwrite ? "true" : "false",
    "Content-Type": options.file.type || "application/octet-stream",
  });
  if (options.file.lastModified) headers["Last-Modified"] = String(options.file.lastModified);
  return headers;
}

async function putWhole(options: UploadOptions): Promise<void> {
  const total = options.file.size;
  const headers = { ...baseHeaders(options), "As-Task": "true", "X-File-Size": String(total) };
  const result = await xhr<unknown>("PUT", apiUrl("/fs/put"), headers, options.file, options.signal,
    sent => options.onProgress({ phase: "sending", sent, total }));
  if (result.code !== 200) throw new UploadError(result.code, result.message);
  options.onProgress({ phase: "sending", sent: total, total });
}

/** Chunk indexes the server does not hold yet, in order. */
export function missingChunks(snapshot: Pick<UploadSnapshot, "total_chunks" | "received">): number[] {
  const have = new Uint8Array(snapshot.total_chunks);
  for (const [from, to] of snapshot.received ?? []) {
    for (let i = Math.max(0, from); i <= Math.min(to, snapshot.total_chunks - 1); i++) have[i] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < have.length; i++) if (!have[i]) out.push(i);
  return out;
}

async function multipart(options: UploadOptions): Promise<void> {
  const { file, signal } = options;
  const total = file.size;
  const init = async (): Promise<UploadSnapshot> => {
    const headers = { ...baseHeaders(options), "X-File-Size": String(total) };
    const result = await xhr<UploadSnapshot>("POST", apiUrl("/fs/multipart/init"), headers, null, signal);
    if (result.code !== 200) throw new UploadError(result.code, result.message);
    return result.data;
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot = await init();
    const id = snapshot.upload_id;
    const size = snapshot.chunk_size;
    const queue = missingChunks(snapshot);
    const inflight = new Map<number, number>();
    let base = snapshot.received_bytes;
    const report = (): void => {
      let sent = base;
      for (const value of inflight.values()) sent += value;
      options.onProgress({ phase: "sending", sent: Math.min(sent, total), total });
    };
    report();

    const sendOne = async (index: number): Promise<void> => {
      const body = file.slice(index * size, Math.min(total, (index + 1) * size));
      for (let tries = 0; ; tries++) {
        inflight.set(index, 0);
        try {
          const result = await xhr<UploadSnapshot>("PUT", apiUrl("/fs/multipart/chunk"),
            authHeaders({ "X-Upload-Id": id, "X-Chunk-Index": String(index), "Content-Type": "application/octet-stream" }),
            body, signal, loaded => { inflight.set(index, loaded); report(); });
          inflight.delete(index);
          if (result.code === 200) { base += body.size; report(); return; }
          if (result.code === 429 || result.code === 409) { await sleep(400 + tries * 200, signal); continue; }
          throw new UploadError(result.code, result.message);
        } catch (error) {
          inflight.delete(index);
          if (error instanceof UploadError && error.code === 0 && tries < 6) { await sleep(1000 * 2 ** Math.min(tries, 4), signal); continue; }
          throw error;
        }
      }
    };

    const workers = Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) await sendOne(index);
    });
    await Promise.all(workers);

    // Completion waits for the drive. Poll the status meanwhile for a second progress bar.
    options.onProgress({ phase: "storing", sent: total, total, storage: 0 });
    let done = false;
    const poll = (async () => {
      while (!done) {
        await sleep(1500, signal).catch(() => undefined);
        if (done || signal.aborted) return;
        const status = await xhr<UploadSnapshot>("GET", apiUrl(`/fs/multipart/status?upload_id=${encodeURIComponent(id)}`), authHeaders(), null, signal).catch(() => null);
        if (status?.code === 200 && !done) options.onProgress({ phase: "storing", sent: total, total, storage: status.data.storage_progress });
      }
    })();
    const result = await xhr<UploadSnapshot>("POST", apiUrl("/fs/multipart/complete"), authHeaders({ "X-Upload-Id": id }), null, signal).finally(() => { done = true; });
    await poll;
    if (result.code === 200) return;
    snapshot = result.data;
    if (snapshot?.state === "failed_retriable") continue; // init resumes the same session with a fresh attempt
    throw new UploadError(result.code, result.message);
  }
  throw new UploadError(500, "多次重试后仍未完成");
}

export async function upload(options: UploadOptions): Promise<void> {
  if (options.multipart && options.file.size >= MULTIPART_MIN) await multipart(options);
  else await putWhole(options);
}
