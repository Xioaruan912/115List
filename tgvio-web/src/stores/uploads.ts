import { create } from "zustand";
import { join } from "../lib/path";
import { upload, UploadError, type UploadProgress } from "../lib/upload";

export type JobState = "queued" | "running" | "done" | "error" | "canceled";

export interface UploadJob {
  id: number;
  name: string; // relative path inside the drop, e.g. "album/01.jpg"
  dir: string; // destination directory the drop landed in
  size: number;
  sent: number;
  phase: UploadProgress["phase"];
  storage: number;
  rate: number; // bytes per second, smoothed
  state: JobState;
  error: string;
  exists: boolean; // failed because the name is taken: offer overwrite
}

interface Entry { file: File; overwrite: boolean; controller?: AbortController }

interface UploadState {
  jobs: UploadJob[];
  multipart: boolean;
  add: (dir: string, files: { file: File; name: string }[]) => void;
  cancel: (id: number) => void;
  retry: (id: number, overwrite?: boolean) => void;
  clearFinished: () => void;
}

const CONCURRENCY = 2;
const entries = new Map<number, Entry>();
let nextId = 1;
let finished: (dir: string) => void = () => undefined;

export function onUploadFinished(handler: (dir: string) => void): void {
  finished = handler;
}

export const useUploads = create<UploadState>((set, getState) => {
  const patch = (id: number, change: Partial<UploadJob>): void =>
    set(state => ({ jobs: state.jobs.map(job => job.id === id ? { ...job, ...change } : job) }));

  const pump = (): void => {
    const { jobs } = getState();
    let running = jobs.filter(job => job.state === "running").length;
    for (const job of jobs) {
      if (running >= CONCURRENCY) break;
      if (job.state !== "queued") continue;
      running++;
      void run(job);
    }
  };

  const run = async (job: UploadJob): Promise<void> => {
    const entry = entries.get(job.id);
    if (!entry) return;
    const controller = new AbortController();
    entry.controller = controller;
    patch(job.id, { state: "running", error: "", exists: false, sent: 0, storage: 0, rate: 0, phase: "sending" });
    let lastAt = performance.now();
    let lastSent = 0;
    let lastPaint = 0;
    try {
      await upload({
        path: join(job.dir, job.name),
        file: entry.file,
        overwrite: entry.overwrite,
        multipart: getState().multipart,
        signal: controller.signal,
        onProgress: progress => {
          const now = performance.now();
          if (now - lastPaint < 120 && progress.sent < progress.total) return;
          lastPaint = now;
          const elapsed = (now - lastAt) / 1000;
          const current = elapsed > 0.25 ? (progress.sent - lastSent) / elapsed : undefined;
          if (current !== undefined) { lastAt = now; lastSent = progress.sent; }
          set(state => ({
            jobs: state.jobs.map(item => item.id !== job.id ? item : {
              ...item,
              sent: progress.sent,
              phase: progress.phase,
              storage: progress.storage ?? item.storage,
              rate: current === undefined ? item.rate : item.rate ? item.rate * 0.6 + current * 0.4 : current,
            }),
          }));
        },
      });
      patch(job.id, { state: "done", sent: job.size, rate: 0 });
      entries.delete(job.id);
      finished(job.dir);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        patch(job.id, { state: "canceled", rate: 0 });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        patch(job.id, {
          state: "error",
          rate: 0,
          error: message,
          exists: error instanceof UploadError && /exist/i.test(message),
        });
      }
    } finally {
      pump();
    }
  };

  return {
    jobs: [],
    multipart: true,
    add(dir, files) {
      const added: UploadJob[] = files.map(({ file, name }) => {
        const id = nextId++;
        entries.set(id, { file, overwrite: false });
        return { id, name, dir, size: file.size, sent: 0, phase: "sending", storage: 0, rate: 0, state: "queued", error: "", exists: false };
      });
      set(state => ({ jobs: [...state.jobs, ...added] }));
      pump();
    },
    cancel(id) {
      const entry = entries.get(id);
      const job = getState().jobs.find(item => item.id === id);
      if (job?.state === "queued") patch(id, { state: "canceled" });
      entry?.controller?.abort();
    },
    retry(id, overwrite) {
      const entry = entries.get(id);
      if (!entry) return;
      if (overwrite !== undefined) entry.overwrite = overwrite;
      patch(id, { state: "queued", error: "", exists: false });
      pump();
    },
    clearFinished() {
      set(state => ({ jobs: state.jobs.filter(job => {
        const keep = job.state === "queued" || job.state === "running";
        if (!keep) entries.delete(job.id);
        return keep;
      }) }));
    },
  };
});
