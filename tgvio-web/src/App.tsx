import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig, motion } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { Redirect, Router, useLocation } from "wouter";
import { applyTheme } from "./components/theme";
import { Toaster } from "./components/Toaster";
import * as actions from "./lib/actions";
import { basePath } from "./lib/config";
import { decodePath } from "./lib/path";
import { syncProgress } from "./lib/progress";
import { isAdmin, isGuest } from "./lib/perm";
import { queryClient } from "./lib/query";
import { Browser } from "./pages/Browser";
import { Login } from "./pages/Login";
import { SharePage } from "./pages/SharePage";
import { usePrefs } from "./stores/prefs";
import { useSession } from "./stores/session";
import { onUploadFinished, useUploads } from "./stores/uploads";

const Manage = lazy(() => import("./pages/manage/Manage"));

onUploadFinished(dir => {
  // Batch: many small files finishing together refresh the folder once.
  clearTimeout((onUploadFinished as unknown as { timer?: number }).timer);
  (onUploadFinished as unknown as { timer?: number }).timer = window.setTimeout(() => void actions.reload(dir, false), 600);
});

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <motion.span className="size-10 rounded-[12px] bg-accent"
        animate={{ scale: [1, 0.82, 1], rotate: [0, 90, 180] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

function Routes() {
  const [location] = useLocation();
  const status = useSession(state => state.status);
  const me = useSession(state => state.me);
  const pathname = decodePath(location);

  // Shares are public: whoever has the link sees them, signed in or not.
  if (location.startsWith("/@s/")) return <SharePage />;
  if (status === "loading") return <Splash />;
  if (location.startsWith("/@login")) {
    return status === "ready" && !isGuest(me) ? <Redirect to="/" replace /> : <Login />;
  }
  if (status !== "ready") return <Redirect to={`/@login?redirect=${encodeURIComponent(location)}`} replace />;
  if (location.startsWith("/@manage")) {
    if (!isAdmin(me)) return <Redirect to="/" replace />;
    return <Suspense fallback={<Splash />}><Manage /></Suspense>;
  }
  return <Browser path={pathname} />;
}

export function App() {
  const boot = useSession(state => state.boot);
  const settings = useSession(state => state.settings);
  const me = useSession(state => state.me);
  const theme = usePrefs(state => state.theme);
  const account = me && !isGuest(me) ? `${me.id}:${me.username}` : null;

  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => { syncProgress(account); }, [account]);
  useEffect(() => { useUploads.setState({ multipart: settings.multipart_enabled !== "false" }); }, [settings.multipart_enabled]);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Router base={basePath}>
          <Routes />
        </Router>
        <Toaster />
        <div className="grain" aria-hidden />
      </MotionConfig>
    </QueryClientProvider>
  );
}
