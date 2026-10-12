import {
  ArrowRightIcon, CheckIcon, FileTextIcon, FilmStripIcon, FolderSimpleIcon, ImageIcon, MusicNotesIcon, FileArchiveIcon, FileCodeIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useAnimate, useMotionValue, useSpring, useTransform } from "motion/react";
import { useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { SplitText } from "../components/SplitText";
import { ThemeButton } from "../components/TopBar";
import { ApiError } from "../lib/api";
import { spring } from "../lib/motion";
import { useSession } from "../stores/session";

const GLYPHS = [FolderSimpleIcon, FilmStripIcon, ImageIcon, MusicNotesIcon, FileTextIcon, FileArchiveIcon, FileCodeIcon];

/** A field of file glyphs that drifts against the pointer; a spotlight brings the nearest ones up. */
function Field() {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 60, damping: 20 });
  const sy = useSpring(py, { stiffness: 60, damping: 20 });
  const x = useTransform(sx, [0, 1], [24, -24]);
  const y = useTransform(sy, [0, 1], [24, -24]);
  const mask = useTransform(() => `radial-gradient(420px circle at ${px.get() * 100}% ${py.get() * 100}%, #000 0%, rgba(0,0,0,0.12) 70%)`);
  const cells = Array.from({ length: 120 }, (_, index) => index);
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerMove={event => { px.set(event.clientX / innerWidth); py.set(event.clientY / innerHeight); }}
      aria-hidden
    >
      <motion.div className="absolute -inset-16 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] content-start gap-0 text-ink"
        style={{ x, y, maskImage: mask, WebkitMaskImage: mask }}>
        {cells.map(index => {
          const Glyph = GLYPHS[(index * 7 + Math.floor(index / 11)) % GLYPHS.length];
          return (
            <span key={index} className="grid aspect-square place-items-center opacity-0"
              style={{ animation: `rise 900ms cubic-bezier(0.16,1,0.3,1) ${200 + ((index * 53) % 900)}ms forwards` }}>
              <Glyph size={26} weight="thin" className="opacity-60" />
            </span>
          );
        })}
      </motion.div>
    </div>
  );
}

export function Login() {
  const signIn = useSession(state => state.signIn);
  const title = useSession(state => state.settings.site_title) || "OpenList";
  const [, navigate] = useLocation();
  const search = useSearch();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const [scope, animateForm] = useAnimate<HTMLFormElement>();
  const shake = (): void => { void animateForm(scope.current, { x: [0, -12, 10, -7, 4, 0] }, { duration: 0.45 }); };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username || !password) { setError("请输入用户名和密码"); shake(); return; }
    setState("busy");
    setError("");
    try {
      await signIn(username, password, otp);
      setState("done");
      const redirect = new URLSearchParams(search).get("redirect");
      setTimeout(() => navigate(redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/", { replace: true }), 520);
    } catch (err) {
      setState("idle");
      if (err instanceof ApiError && err.code === 402) { setNeedOtp(true); setError(otp ? "两步验证码不正确" : "请输入两步验证码"); }
      else if (err instanceof ApiError && err.code === 429) setError("尝试次数过多，请稍后再试");
      else if (err instanceof ApiError && (err.code === 400 || err.code === 401)) setError("用户名或密码不正确");
      else setError(err instanceof Error ? err.message : String(err));
      shake();
    }
  };

  return (
    <motion.div className="relative min-h-dvh overflow-hidden bg-bg"
      animate={state === "done" ? { scale: 1.06, opacity: 0 } : { scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease: [0.4, 0, 1, 1] }}>
      <Field />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent lg:bg-gradient-to-r" />
      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10"><ThemeButton /></div>
      <div className="relative mx-auto grid min-h-dvh max-w-[1200px] items-end gap-10 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-24 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:pb-0">
        <div className="pointer-events-none">
          <motion.span className="mb-6 grid size-12 place-items-center rounded-2xl bg-accent text-2xl font-bold text-accent-ink"
            initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...spring.bouncy, delay: 0.1 }}>
            {title.slice(0, 1).toUpperCase()}
          </motion.span>
          <h1 className="text-[clamp(40px,7vw,84px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            <SplitText text={title} delay={150} />
          </h1>
          <motion.p className="mt-4 max-w-[34ch] text-[15px] text-muted" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.6 }}>
            你的网盘、本地磁盘和挂载存储，在一个地方浏览、预览和整理。
          </motion.p>
        </div>

        <motion.form
          ref={scope}
          onSubmit={submit}
          className="glass relative w-full max-w-[400px] justify-self-start rounded-[var(--radius-sheet)] p-6 hairline lg:justify-self-end"
          style={{ boxShadow: "var(--shadow-float)" }}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring.sheet, delay: 0.35 }}
        >
          <h2 className="text-lg font-semibold tracking-tight">登录</h2>
          <div className="mt-5 flex flex-col gap-4">
            <label>
              <span className="label">用户名</span>
              <input className="field" autoComplete="username" autoFocus value={username} onChange={event => setUsername(event.target.value)} />
            </label>
            <label>
              <span className="label">密码</span>
              <input className="field" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <AnimatePresence initial={false}>
              {needOtp && (
                <motion.label initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.snappy} className="overflow-hidden">
                  <span className="label">两步验证码</span>
                  <input className="field font-mono tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} />
                </motion.label>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {error && (
              <motion.p className="mt-3 text-[13px] text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert">{error}</motion.p>
            )}
          </AnimatePresence>
          <motion.button type="submit" disabled={state !== "idle"} layout
            className="btn btn-primary mt-5 h-11 w-full overflow-hidden text-[15px]" transition={spring.snappy}>
            <AnimatePresence mode="popLayout" initial={false}>
              {state === "idle" && <motion.span key="idle" className="flex items-center gap-2" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}>进入 <ArrowRightIcon size={16} weight="bold" /></motion.span>}
              {state === "busy" && <motion.span key="busy" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}><span className="spin block size-5 rounded-full border-2 border-accent-ink/25 border-t-accent-ink" /></motion.span>}
              {state === "done" && <motion.span key="done" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}><CheckIcon size={20} weight="bold" /></motion.span>}
            </AnimatePresence>
          </motion.button>
          <button type="button" className="mt-3 w-full text-center text-[13px] text-muted hover:text-ink" onClick={() => navigate("/")}>以访客身份浏览</button>
        </motion.form>
      </div>
    </motion.div>
  );
}
