import { ServerTasks } from "../../components/Transfers";
import { PageHeader } from "./Form";

export default function Tasks() {
  return (
    <div>
      <PageHeader title="任务" detail="上传、复制、移动和离线下载在服务器上的进度，每 2.5 秒刷新" />
      <div className="max-w-3xl"><ServerTasks /></div>
    </div>
  );
}
