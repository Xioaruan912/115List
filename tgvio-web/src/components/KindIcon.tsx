import {
  FileArchiveIcon, FileCodeIcon, FileDocIcon, FileIcon, FileMdIcon, FilePdfIcon, FileTextIcon,
  FilmStripIcon, FolderSimpleIcon, ImageIcon, MusicNotesIcon, type IconProps,
} from "@phosphor-icons/react";
import type { Kind } from "../lib/kind";

const ICONS = {
  folder: FolderSimpleIcon,
  video: FilmStripIcon,
  audio: MusicNotesIcon,
  image: ImageIcon,
  text: FileTextIcon,
  markdown: FileMdIcon,
  code: FileCodeIcon,
  pdf: FilePdfIcon,
  archive: FileArchiveIcon,
  doc: FileDocIcon,
  file: FileIcon,
} satisfies Record<Kind, unknown>;

export function KindIcon({ kind, ...props }: { kind: Kind } & IconProps) {
  const Icon = ICONS[kind];
  return <Icon {...props} />;
}
