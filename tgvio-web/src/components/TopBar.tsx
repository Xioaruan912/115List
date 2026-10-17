import { ArrowUUpLeftIcon, FilmSlateIcon, CaretRightIcon, GearIcon, ListBulletsIcon, MagnifyingGlassIcon, MoonIcon, ShareNetworkIcon, SignOutIcon, SquaresFourIcon, SunIcon, UserIcon, HouseIcon, DesktopIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type DragEvent } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "../hooks/useMedia";
import * as actions from "../lib/actions";
import { spring } from "../lib/motion";
import { encodePath, parent, segments } from "../lib/path";
import { can, isAdmin, isGuest, Perm } from "../lib/perm";
import { resolvedTheme, usePrefs, type Theme } from "../stores/prefs";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { Mark } from "./Mark";
import { Menu } from "./Menu";
import { switchTheme } from "./theme";

function Crumb({ label, path, current }: { label: React.ReactNode; path: string; current: boolean }) {
  const [, navigate] = useLocation();
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    const raw = event.dataTransfer.getData("application/x-tgvio");
    if (!raw) return;
    const data = JSON.parse(raw) as { dir: string; names: string[] };
    if (data.dir !== path) void actions.transfer("move", data.dir, path, data.names);
  };
  return (
    <button
      className={`max-w-[18ch] truncate rounded-lg px-2 py-1 text-[13.5px] transition duration-200 ${current ? "font-medium text-ink" : "text-muted hover:bg-[var(--hover)] hover:text-ink"} ${over ? "scale-110 bg-accent text-accent-ink" : ""}`}
      onClick={() => !current && navigate(encodePath(path))}
      onDragOver={event => { if (!current && event.dataTransfer.types.includes("application/x-tgvio")) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      aria-current={current ? "page" : undefined}
    >
      {label}
    </button>
  );
}

export function Breadcrumbs({ path }: { path: string }) {
  const mobile = useIsMobile();
  const parts = segments(path);
  const all = parts.map((part, index) => ({ label: part, path: "/" + parts.slice(0, index + 1).join("/") }));
  const shown = mobile ? all.slice(-1) : all.length > 4 ? [all[0], null, ...all.slice(-2)] : all;
  return (
    <nav aria-label="路径" className="flex min-w-0 items-center">
      <motion.ol layout className="flex min-w-0 items-center" transition={spring.snappy}>
        <motion.li layout="position" transition={spring.snappy}>
          <Crumb label={<HouseIcon size={16} weight={parts.length ? "regular" : "fill"} />} path="/" current={parts.length === 0} />
        </motion.li>
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((crumb, index) => (
            <motion.li
              key={crumb ? crumb.path : `gap-${index}`}
              layout="position"
              className="flex min-w-0 items-center"
              initial={{ opacity: 0, x: 14, filter: "blur(3px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -10, transition: { duration: 0.14 } }}
              transition={spring.snappy}
            >
              <CaretRightIcon size={11} className="mx-0.5 shrink-0 text-faint" />
              {crumb ? <Crumb label={crumb.label} path={crumb.path} current={crumb.path === path} /> : <span className="px-1 text-faint">…</span>}
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ol>
    </nav>
  );
}

const VIEW_LABEL = { grid: "网格", list: "列表", cinema: "影院" } as const;
const VIEW_ICON = { grid: <SquaresFourIcon size={16} />, list: <ListBulletsIcon size={16} />, cinema: <FilmSlateIcon size={16} /> } as const;

function ViewToggle() {
  const view = usePrefs(state => state.view);
  const setView = usePrefs(state => state.setView);
  return (
    <div className="relative flex rounded-[11px] p-0.5 hairline" role="group" aria-label="视图">
      {(["grid", "list", "cinema"] as const).map(mode => (
        <button key={mode} className={`relative grid size-8 place-items-center rounded-[9px] transition-colors ${view === mode ? "text-ink" : "text-muted hover:text-ink"}`}
          onClick={() => setView(mode)} aria-pressed={view === mode} aria-label={VIEW_LABEL[mode]} title={VIEW_LABEL[mode]}>
          {view === mode && <motion.span layoutId="view-thumb" className="absolute inset-0 rounded-[9px] bg-raised" style={{ boxShadow: "var(--shadow-lift)" }} transition={spring.pop} />}
          <span className="relative">{VIEW_ICON[mode]}</span>
        </button>
      ))}
    </div>
  );
}

const THEME_ICON: Record<Theme, React.ReactNode> = { system: <DesktopIcon size={16} />, dark: <MoonIcon size={16} />, light: <SunIcon size={16} /> };

export function ThemeButton() {
  const theme = usePrefs(state => state.theme);
  const order: Theme[] = ["system", "dark", "light"];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  return (
    <button className="icon-btn" aria-label={`主题：${theme}`} title="切换主题"
      onClick={event => switchTheme(next, event.clientX, event.clientY)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={theme} initial={{ rotate: -90, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.4, opacity: 0 }} transition={spring.pop}>
          {THEME_ICON[theme]}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Account() {
  const me = useSession(state => state.me);
  const signOut = useSession(state => state.signOut);
  const [, navigate] = useLocation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mobile = useIsMobile();
  const view = usePrefs(state => state.view);
  const theme = usePrefs(state => resolvedTheme(state.theme));
  if (!me) return null;
  const guest = isGuest(me);
  const initial = (guest ? "访" : me.username.slice(0, 1)).toUpperCase();
  return (
    <>
      <button
        className="grid size-8 place-items-center rounded-[10px] bg-raised text-[13px] font-semibold hairline transition-transform active:scale-95"
        aria-label="账户"
        onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 8 }); }}
      >
        {initial}
      </button>
      <Menu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        entries={[
          { heading: guest ? "访客" : me.username },
          ...(isAdmin(me) ? [{ label: "管理", icon: <GearIcon size={15} />, run: () => navigate("/@manage") }] : []),
          ...(!guest ? [{ label: "账户资料", icon: <UserIcon size={15} />, run: () => useUi.getState().openDialog({ kind: "account" }) }] : []),
          ...(can(me, Perm.Share) ? [{ label: "我的分享", icon: <ShareNetworkIcon size={15} />, run: () => useUi.getState().openDialog({ kind: "shares" }) }] : []),
          ...(mobile ? [
            "divider" as const,
            ...(["grid", "list", "cinema"] as const).filter(mode => mode !== view).map(mode => ({ label: `${VIEW_LABEL[mode]}视图`, icon: VIEW_ICON[mode], run: () => usePrefs.getState().setView(mode) })),
            { label: theme === "light" ? "深色主题" : "浅色主题", icon: theme === "light" ? <MoonIcon size={15} /> : <SunIcon size={15} />, run: () => switchTheme(theme === "light" ? "dark" : "light", innerWidth - 30, 30) },
          ] : []),
          "divider",
          guest
            ? { label: "登录", icon: <SignOutIcon size={15} />, run: () => navigate("/@login") }
            : { label: "退出登录", icon: <SignOutIcon size={15} />, danger: true, run: () => { void signOut(); } },
        ]}
      />
    </>
  );
}

export function TopBar({ path }: { path: string }) {
  const [, navigate] = useLocation();
  const mobile = useIsMobile();
  const setPalette = useUi(state => state.setPalette);
  const palette = useUi(state => state.palette);
  const title = useSession(state => state.settings.site_title) || "OpenList";
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]">
      <div className="absolute inset-0 -bottom-6 bg-gradient-to-b from-bg via-bg/85 to-transparent" />
      <div className="pointer-events-auto relative mx-auto flex h-[60px] max-w-[1400px] items-center gap-2 px-3 sm:gap-3 sm:px-8">
        <AnimatePresence initial={false} mode="popLayout">
          {mobile && path !== "/" ? (
            <motion.button key="back" className="icon-btn" aria-label="上一级" onClick={() => navigate(encodePath(parent(path)))}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={spring.snappy}>
              <ArrowUUpLeftIcon size={18} />
            </motion.button>
          ) : (
            <motion.button key="mark" onClick={() => navigate("/")} aria-label={title}
              className="shrink-0 transition-transform hover:rotate-[-8deg] active:scale-90"
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring.pop}>
              <Mark className="size-8 text-[16px]" />
            </motion.button>
          )}
        </AnimatePresence>
        <div className="min-w-0 flex-1"><Breadcrumbs path={path} /></div>
        {!palette && (
          <motion.button
            layoutId="palette"
            onClick={() => setPalette(true)}
            className="flex h-9 items-center gap-2 rounded-[11px] bg-surface px-3 text-muted hairline transition-colors hover:text-ink sm:w-60"
            transition={spring.sheet}
            aria-label="搜索"
          >
            <MagnifyingGlassIcon size={16} />
            <span className="hidden flex-1 text-left text-[13px] sm:block">搜索或输入命令</span>
            <kbd className="hidden rounded-md px-1.5 font-mono text-[11px] text-faint hairline sm:block">/</kbd>
          </motion.button>
        )}
        {palette && <span className="h-9 sm:w-60" />}
        <div className="hidden sm:block"><ViewToggle /></div>
        <div className="max-sm:hidden"><ThemeButton /></div>
        <Account />
      </div>
    </header>
  );
}

