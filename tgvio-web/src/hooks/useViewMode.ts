import { usePrefs, type ViewMode } from "../stores/prefs";
import { useLibraryScope } from "./useLibraryScope";

const ALL: ViewMode[] = ["grid", "list", "cinema"];
const PLAIN: ViewMode[] = ["grid", "list"];

/**
 * The view a folder shows and the views offered there: 影院 only inside the
 * 影视库 paths (elsewhere it shows as the grid; the choice is kept for the library).
 */
export function useViewMode(path: string): { view: ViewMode; modes: ViewMode[] } {
  const chosen = usePrefs(state => state.view);
  const library = useLibraryScope();
  const cinema = !library.known || library.has(path);
  return { view: chosen === "cinema" && !cinema ? "grid" : chosen, modes: cinema ? ALL : PLAIN };
}
