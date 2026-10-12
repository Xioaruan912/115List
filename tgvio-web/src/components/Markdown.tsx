import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

/** Markdown from readmes and meta headers, sanitised. Loaded lazily with marked. */
export default function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: false }) as string), [source]);
  return <div className={`prose-ink ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
