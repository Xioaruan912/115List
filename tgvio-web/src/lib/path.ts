/** Normalise to "/a/b" form: leading slash, no trailing slash, no empty parts. */
export function normalize(path: string): string {
  const parts = path.split("/").filter(part => part && part !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export function join(...parts: string[]): string {
  return normalize(parts.join("/"));
}

export function parent(path: string): string {
  const clean = normalize(path);
  const index = clean.lastIndexOf("/");
  return index <= 0 ? "/" : clean.slice(0, index);
}

export function basename(path: string): string {
  const clean = normalize(path);
  return clean.slice(clean.lastIndexOf("/") + 1);
}

export function segments(path: string): string[] {
  return normalize(path).split("/").filter(Boolean);
}

/** A file path as a URL path: every segment percent-encoded. */
export function encodePath(path: string): string {
  return segments(path).map(encodeURIComponent).join("/").replace(/^/, "/");
}

/** The inverse of encodePath for a location pathname. Bad escapes stay as typed. */
export function decodePath(pathname: string): string {
  return normalize(pathname.split("/").map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join("/"));
}

export function extname(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function isInside(child: string, ancestor: string): boolean {
  const a = normalize(ancestor);
  const c = normalize(child);
  return a === "/" || c === a || c.startsWith(a + "/");
}
