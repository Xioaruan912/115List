import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { PosterWall } from "../components/PosterWall";
import { SplitText } from "../components/SplitText";
import { ApiError } from "../lib/api";
import { spring } from "../lib/motion";
import { useSession } from "../stores/session";

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
      setTimeout(() => navigate(redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/", { replace: true }), 700);
    } catch (err) {
      setState("idle");
      if (err instanceof ApiError && err.code === 402) { setNeedOtp(true); setError(otp ? "两步验证码不正确" : "请输入两步验证码"); }
      else if (err instanceof ApiError && err.code === 429) setError("尝试次数过多，请稍后再试");
      else if (err instanceof ApiError && (err.code === 400 || err.code === 401)) setError("用户名或密码不正确");
      else setError(err instanceof Error ? err.message : String(err));
      shake();
    }
  };

  const leaving = state === "done";
  return (
    <div className="theme-dark relative min-h-dvh overflow-hidden bg-[#070708] text-ink">
      <PosterWall leaving={leaving} />
      <motion.div
        className="relative mx-auto grid min-h-dvh max-w-[1240px] grid-rows-[1fr_auto] gap-8 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 lg:grid-cols-[1.15fr_400px] lg:grid-rows-1 lg:items-center lg:gap-16"
        animate={leaving ? { opacity: 0, y: 24 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 1, 1] }}
      >
        <div className="pointer-events-none flex flex-col justify-end pb-2 lg:justify-center lg:pb-0">
          <motion.div className="mb-5 flex items-center gap-3" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.3 }}>
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-lg font-bold text-accent-ink">{title.slice(0, 1).toUpperCase()}</span>
            <span className="text-[13px] font-medium tracking-[0.3em] text-white/70">正在上映</span>
          </motion.div>
          <h1 className="text-[clamp(44px,8vw,104px)] font-semibold leading-[0.98] tracking-[-0.05em] text-white [text-shadow:0_8px_40px_rgb(0_0_0/0.6)]">
            <SplitText text={title} delay={450} />
          </h1>
          <motion.p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-white/70 sm:text-[17px]"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            你的片库与网盘，登录后开场。
          </motion.p>
        </div>

        <motion.form
          ref={scope}
          onSubmit={submit}
          className="glass relative -mx-5 w-auto self-end rounded-t-[26px] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 hairline sm:mx-0 sm:mb-10 sm:w-full sm:max-w-[400px] sm:rounded-[var(--radius-sheet)] sm:p-7 lg:mb-0 lg:self-center"
          style={{ boxShadow: "var(--shadow-float)", background: "rgb(16 16 18 / 0.72)" }}
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.sheet, delay: 0.7 }}
        >
          <h2 className="text-lg font-semibold tracking-tight">登录</h2>
          <div className="mt-5 flex flex-col gap-4">
            <label>
              <span className="label">用户名</span>
              <input className="field" autoComplete="username" autoCapitalize="off" autoCorrect="off" value={username} onChange={event => setUsername(event.target.value)} />
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
            className="btn btn-primary mt-5 h-12 w-full overflow-hidden text-[15px]" transition={spring.snappy}>
            <AnimatePresence mode="popLayout" initial={false}>
              {state === "idle" && <motion.span key="idle" className="flex items-center gap-2" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}>开场 <ArrowRightIcon size={16} weight="bold" /></motion.span>}
              {state === "busy" && <motion.span key="busy" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}><span className="spin block size-5 rounded-full border-2 border-accent-ink/25 border-t-accent-ink" /></motion.span>}
              {state === "done" && <motion.span key="done" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}><CheckIcon size={20} weight="bold" /></motion.span>}
            </AnimatePresence>
          </motion.button>
          <button type="button" className="mt-3 h-9 w-full text-center text-[13px] text-muted hover:text-ink" onClick={() => navigate("/")}>以访客身份浏览</button>
        </motion.form>
      </motion.div>
    </div>
  );
}
