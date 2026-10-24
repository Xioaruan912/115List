import { tmdbRename } from "../api/rename";
import { toast } from "../stores/toast";
import { queryClient } from "./query";

/** Puts one 整理 run back (rename/undo), then shows what came back. */
export async function undoRun(id: string): Promise<void> {
  try {
    const { changes } = await tmdbRename.undo(id);
    toast.success("已撤销", `改回了 ${changes} 项`);
  } catch (error) {
    toast.error("没能全部撤销", error);
  }
  void queryClient.invalidateQueries();
}
