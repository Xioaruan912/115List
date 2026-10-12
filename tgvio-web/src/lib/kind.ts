import { extname } from "./path";
import { ObjType, type Obj } from "./types";

export type Kind = "folder" | "video" | "audio" | "image" | "text" | "markdown" | "code" | "pdf" | "archive" | "doc" | "file";

const EXT: Record<string, Kind> = {};
const add = (kind: Kind, list: string): void => { for (const ext of list.split(" ")) EXT[ext] = kind; };
add("video", "mp4 m4v mkv webm mov avi wmv flv ts m2ts mpg mpeg 3gp rmvb rm vob ogv");
add("audio", "mp3 flac wav m4a aac ogg opus ape wma alac aiff");
add("image", "jpg jpeg png gif webp avif bmp svg heic heif ico tiff");
add("markdown", "md markdown mdx");
add("code", "js ts tsx jsx json yaml yml toml xml html css scss go py rs java kt c h cpp hpp cs sh bash zsh ps1 sql lua rb php swift vue ini conf env dockerfile");
add("text", "txt log srt ass ssa vtt nfo csv tsv lrc");
add("pdf", "pdf");
add("archive", "zip rar 7z tar gz tgz bz2 xz zst iso");
add("doc", "doc docx xls xlsx ppt pptx odt ods odp epub");

export function kindOf(obj: Pick<Obj, "name" | "is_dir" | "type">): Kind {
  if (obj.is_dir) return "folder";
  const byExt = EXT[extname(obj.name)];
  if (byExt) return byExt;
  switch (obj.type) {
    case ObjType.Video: return "video";
    case ObjType.Audio: return "audio";
    case ObjType.Image: return "image";
    case ObjType.Text: return "text";
    default: return "file";
  }
}

/** Kinds the viewer can show inline. */
export function previewable(kind: Kind): boolean {
  return kind !== "folder" && kind !== "archive" && kind !== "doc" && kind !== "file";
}

/** Kinds that page left and right inside the viewer as one gallery. */
export function galleryKind(kind: Kind): "media" | "other" {
  return kind === "image" || kind === "video" ? "media" : "other";
}
