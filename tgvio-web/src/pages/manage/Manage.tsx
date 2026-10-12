import { ArrowLeftIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Dialogs } from "../../components/Dialogs";
import { ThemeButton } from "../../components/TopBar";
import { spring } from "../../lib/motion";
import { useSession } from "../../stores/session";

const PAGES = [
  ["", "概览", lazy(() => import("./Overview"))],
  ["storages", "存储", lazy(() => import("./Storages"))],
  ["users", "用户", lazy(() => import("./Users"))],
  ["metas", "元信息", lazy(() => import("./Metas"))],
  ["settings", "设置", lazy(() => import("./Settings"))],
  ["tasks", "任务", lazy(() => import("./Tasks"))],
] as const;

export default function Manage() {
  const [location] = useLocation();
  const title = useSession(state => state.settings.site_title) || "OpenList";
  const slug = location.replace(/^\/@manage\/?/, "").split("/")[0];
  const index = Math.max(0, PAGES.findIndex(([key]) => key === slug));
  const previous = useRef(index);
  const direction = index >= previous.current ? 1 : -1;
  useEffect(() => { previous.current = index; }, [index]);
  useEffect(() => { document.title = `${PAGES[index][1]} - 管理 - ${title}`; }, [index, title]);
  const Page = PAGES[index][2];

  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-20 border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-3 px-3 sm:px-8">
          <Link href="/" className="btn btn-ghost -ml-2 px-2.5" aria-label="返回文件"><ArrowLeftIcon size={17} /><span className="max-sm:hidden">文件</span></Link>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="管理">
            {PAGES.map(([key, label], i) => (
              <Link key={key} href={key ? `/@manage/${key}` : "/@manage"}
                className={`relative h-9 shrink-0 rounded-[10px] px-3 py-2 text-[13.5px] transition-colors ${i === index ? "text-ink" : "text-muted hover:text-ink"}`}
                aria-current={i === index ? "page" : undefined}>
                {i === index && <motion.span layoutId="manage-tab" className="absolute inset-0 rounded-[10px] bg-[var(--hover)]" transition={spring.snappy} />}
                {i === index && <motion.span layoutId="manage-tab-bar" className="absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full bg-accent" transition={spring.snappy} />}
                <span className="relative">{label}</span>
              </Link>
            ))}
          </nav>
          <ThemeButton />
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 sm:px-8">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div key={index} custom={direction}
            variants={{ enter: (d: number) => ({ opacity: 0, x: d * 36 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -d * 36 }) }}
            initial="enter" animate="center" exit="exit" transition={{ ...spring.snappy, opacity: { duration: 0.18 } }}>
            <Suspense fallback={<div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-[var(--radius-tile)]" />)}</div>}>
              <Page />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      <Dialogs />
    </div>
  );
}
