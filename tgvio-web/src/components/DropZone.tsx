import { UploadSimpleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { spring } from "../lib/motion";
import { useUploads } from "../stores/uploads";

type Entry = FileSystemEntry;

function readAll(reader: FileSystemDirectoryReader): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = [];
    const next = (): void => reader.readEntries(batch => { if (!batch.length) resolve(out); else { out.push(...batch); next(); } }, reject);
    next();
  });
}

async function walk(entry: Entry, prefix: string, out: { file: File; name: string }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, name: prefix + file.name });
  } else if (entry.isDirectory) {
    for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/** Collect dropped files, folders included (recursively), keeping their relative paths. */
export async function filesFromDrop(data: DataTransfer): Promise<{ file: File; name: string }[]> {
  const out: { file: File; name: string }[] = [];
  const entries = [...data.items].map(item => item.webkitGetAsEntry?.()).filter((entry): entry is Entry => !!entry);
  if (entries.length) {
    for (const entry of entries) await walk(entry, "", out);
    return out;
  }
  return [...data.files].map(file => ({ file, name: file.name }));
}

/** Files dragged in from the desktop: the whole window becomes the target. */
export function DropZone({ dir, enabled }: { dir: string; enabled: boolean }) {
  const [over, setOver] = useState(false);
  const add = useUploads(state => state.add);
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const isFiles = (event: DragEvent): boolean => !!event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent): void => { if (!isFiles(event)) return; depth++; setOver(true); };
    const leave = (event: DragEvent): void => { if (!isFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const overHandler = (event: DragEvent): void => { if (isFiles(event)) event.preventDefault(); };
    const drop = (event: DragEvent): void => {
      if (!isFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      void filesFromDrop(event.dataTransfer).then(files => { if (files.length) add(dir, files); });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overHandler);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overHandler);
      window.removeEventListener("drop", drop);
    };
  }, [dir, enabled, add]);

  return createPortal(
    <AnimatePresence>
      {over && (
        <motion.div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-scrim p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="flex size-full flex-col items-center justify-center gap-4 rounded-[28px]"
            style={{
              backgroundImage: "linear-gradient(90deg, var(--accent) 50%, transparent 0), linear-gradient(90deg, var(--accent) 50%, transparent 0), linear-gradient(0deg, var(--accent) 50%, transparent 0), linear-gradient(0deg, var(--accent) 50%, transparent 0)",
              backgroundRepeat: "repeat-x, repeat-x, repeat-y, repeat-y",
              backgroundSize: "24px 2px, 24px 2px, 2px 24px, 2px 24px",
              backgroundPosition: "0 0, 0 100%, 0 0, 100% 0",
              animation: "marching 0.8s linear infinite",
            }}
            initial={{ scale: 1.04 }} animate={{ scale: 1 }} exit={{ scale: 1.04 }} transition={spring.soft}
          >
            <motion.span className="grid size-20 place-items-center rounded-3xl bg-accent text-accent-ink"
              initial={{ y: 30, rotate: -10 }} animate={{ y: [0, -10, 0], rotate: 0 }} transition={{ y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, rotate: spring.pop }}>
              <UploadSimpleIcon size={36} weight="bold" />
            </motion.span>
            <p className="text-2xl font-semibold tracking-tight">松手上传到 <span className="text-accent-text">{dir}</span></p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
