import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { settings } from "../../api/admin";
import { spring } from "../../lib/motion";
import type { SettingItem } from "../../lib/types";
import { useSession } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Field, PageHeader } from "./Form";
import { ErrorState } from "../../components/ErrorState";
import { SessionSettings } from "../../components/Devices";

// 100 is ours: TGVIO settings that are not OpenList setting items.
const POSTERS = 100;
const LOGIN = 101;
const GROUPS: [number, string][] = [[1, "站点"], [2, "样式"], [3, "预览"], [4, "全局"], [POSTERS, "影视库"], [LOGIN, "登录"], [11, "流量"], [6, "索引"], [5, "离线下载"], [7, "单点登录"], [8, "LDAP"], [9, "S3"], [10, "FTP"]];

const PosterSettings = lazy(() => import("./PosterSettings"));

const NAMES: Record<string, string> = {
  site_title: "站点标题", announcement: "公告", pagination_type: "分页方式", default_page_size: "默认分页大小", allow_indexed: "允许搜索引擎收录",
  allow_mounted: "显示挂载容量", robots_txt: "robots.txt", logo: "Logo", favicon: "Favicon", main_color: "主色", custom_head: "自定义 head",
  custom_body: "自定义 body", text_types: "文本类型", audio_types: "音频类型", video_types: "视频类型", image_types: "图片类型",
  proxy_types: "代理类型", proxy_ignore_headers: "代理忽略的请求头", audio_autoplay: "音频自动播放", video_autoplay: "视频自动播放",
  hide_files: "隐藏文件规则", customize_head: "自定义 head", customize_body: "自定义 body", link_expiration: "直链有效期（小时）",
  sign_all: "全部签名", privacy_regs: "隐私正则", ocr_api: "OCR 接口", filename_char_mapping: "文件名字符映射", forward_direct_link_params: "转发直链参数",
  search_index: "搜索索引", autoupdate_index: "自动更新索引", ignore_paths: "忽略路径", max_index_depth: "最大索引深度",
  multipart_enabled: "分片上传", multipart_chunk_size: "分片大小（MB）", version: "版本",
};

function Group({ group }: { group: number }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings", group], queryFn: () => settings.list([group]) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft({}); }, [query.data]);
  const items = useMemo(() => (query.data ?? []).filter(item => item.flag !== 3).sort((a, b) => a.index - b.index), [query.data]);
  const dirty = Object.keys(draft).length;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const changed: SettingItem[] = items.filter(item => item.key in draft).map(item => ({ ...item, value: draft[item.key] }));
      await settings.save(changed);
      toast.success("已保存设置", `${changed.length} 项`);
      await client.invalidateQueries({ queryKey: ["settings", group] });
      void useSession.getState().boot();
    } catch (error) { toast.error("保存失败", error); }
    setBusy(false);
  };
  if (query.isPending) return <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return (
    <div>
      <div className="grid gap-5">
        {items.map((item, index) => (
          <motion.div key={item.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { ...spring.snappy, delay: Math.min(index, 16) * 0.025 } }}>
            <Field spec={{ name: item.key, label: NAMES[item.key] ?? item.key, type: item.type, options: item.options, help: item.help, readOnly: item.flag === 2 }}
              value={draft[item.key] ?? item.value} onChange={value => setDraft(state => ({ ...state, [item.key]: String(value) }))} />
          </motion.div>
        ))}
        {!items.length && <p className="text-muted">这个分组没有设置项。</p>}
      </div>
      <AnimatePresence>
        {dirty > 0 && (
          <motion.div className="glass sticky bottom-6 mt-8 flex items-center justify-between gap-4 rounded-2xl px-4 py-3 hairline" style={{ boxShadow: "var(--shadow-float)" }}
            initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} transition={spring.pop}>
            <span className="text-[13.5px]">{dirty} 项未保存</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setDraft({})}>还原</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>保存</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Settings() {
  const [group, setGroup] = useState(1);
  return (
    <div>
      <PageHeader title="设置" />
      <div className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {GROUPS.map(([id, label]) => (
          <button key={id} className={`relative h-9 shrink-0 rounded-[10px] px-3.5 touch:h-11 text-[13.5px] ${group === id ? "text-accent-ink" : "text-muted hover:text-ink"}`} onClick={() => setGroup(id)}>
            {group === id && <motion.span layoutId="settings-group" className="absolute inset-0 rounded-[10px] bg-accent" transition={spring.snappy} />}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={group} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
          {group === POSTERS ? <Suspense fallback={null}><PosterSettings /></Suspense> : group === LOGIN ? <SessionSettings /> : <Group group={group} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
