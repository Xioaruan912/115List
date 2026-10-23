import { motion, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from "motion/react";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";

/**
 * The login backdrop: a wall of film posters on a tilted plane, columns drifting
 * up and down at different speeds. The posters are drawn here (gradients and type),
 * so the page loads nothing from outside and shows nothing from the drive before
 * anyone has signed in. Every column moves with one CSS transform animation, so
 * the whole wall runs on the compositor.
 */

const TITLES = [
  "夜行列车", "雾港", "第七个夏天", "盐与铁", "LOW TIDE", "北纬 31°", "无声的河", "MIDNIGHT ARCADE", "回声", "长镜头",
  "霓虹之下", "SLOW BURN", "白昼漫游", "海的另一边", "最后一班渡轮", "STATIC", "南方来信", "失重", "GOLDEN HOUR", "暗房",
  "风暴眼", "十一月", "PARALLAX", "空城", "DEEP FOCUS", "花火", "远山", "AFTERGLOW", "荒原", "倒带", "FAST FORWARD", "雨季",
  "旧城往事", "NIGHT SHIFT", "蓝色时刻", "逆光",
];
const CREDITS = ["一部电影", "导演剪辑版", "全新修复", "限定上映", "原声收录", "4K 修复版", "首映礼", "电影节入围"];

const PALETTES: [string, string, string][] = [
  ["#0f2a3a", "#f08a4b", "#f6e7d0"], // teal / orange
  ["#1a0c10", "#d6334a", "#f3d9c4"], // crimson night
  ["#16140d", "#d9a441", "#efe6cf"], // ochre
  ["#0b1a2e", "#5aa9e6", "#e6f1fb"], // ice
  ["#101410", "#c4ec5c", "#eef5dc"], // the site accent
  ["#22110a", "#ff7a3d", "#ffe3cc"], // ember
  ["#0d0d12", "#9aa3b8", "#eceef3"], // silver
  ["#1c1f12", "#8fae4d", "#e9ecd8"], // olive
  ["#250d1d", "#e8618c", "#fbe0ea"], // rose
  ["#071c1c", "#3fc1a5", "#d9f6ef"], // jade
];

function random(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export interface Poster { style: CSSProperties; title: string; credit: string; year: number; layout: number; ink: string; accent: string }

export function makePoster(seed: number): Poster {
  const r = random(seed + 1);
  const [base, accent, light] = PALETTES[Math.floor(r() * PALETTES.length)];
  const layout = Math.floor(r() * 5);
  const x = Math.round(20 + r() * 60);
  const y = Math.round(18 + r() * 40);
  const angle = Math.round(r() * 360);
  let background: string;
  switch (layout) {
    case 0: // sun over a horizon
      background = `radial-gradient(circle at ${x}% ${y}%, ${accent} 0 17%, transparent 17.5%), linear-gradient(180deg, ${base} 0%, color-mix(in srgb, ${accent} 45%, ${base}) 62%, ${base} 62.4%, #050505 100%)`;
      break;
    case 1: // bold diagonal bands
      background = `repeating-linear-gradient(${angle}deg, ${accent} 0 14px, transparent 14px 46px), linear-gradient(160deg, ${base}, #050505)`;
      break;
    case 2: // spotlight cone
      background = `radial-gradient(ellipse 60% 85% at ${x}% 0%, color-mix(in srgb, ${light} 70%, transparent) 0%, transparent 70%), radial-gradient(circle at 50% 110%, ${accent} 0%, transparent 55%), ${base}`;
      break;
    case 3: // flat colour field
      background = `linear-gradient(${angle}deg, ${accent}, color-mix(in srgb, ${accent} 55%, ${base}))`;
      break;
    default: // film strip
      background = `linear-gradient(90deg, #050505 0 9%, transparent 9% 91%, #050505 91%), repeating-linear-gradient(180deg, transparent 0 10px, ${light} 10px 16px, transparent 16px 22px), radial-gradient(circle at ${x}% ${y}%, ${accent} 0%, ${base} 70%)`;
  }
  return {
    style: { background },
    title: TITLES[Math.floor(r() * TITLES.length)],
    credit: CREDITS[Math.floor(r() * CREDITS.length)],
    year: 1979 + Math.floor(r() * 47),
    layout,
    ink: layout === 3 ? base : light,
    accent,
  };
}

const PosterCard = memo(function PosterCard({ poster }: { poster: Poster }) {
  const { title, credit, year, layout, ink } = poster;
  const latin = /^[A-Z0-9 °]+$/.test(title);
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[10px]" style={{ ...poster.style, boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.8), inset 0 0 0 1px rgb(255 255 255 / 0.06)" }}>
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
      {layout === 3 && <span className="absolute left-[8%] top-[5%] text-[clamp(28px,4.4vw,64px)] font-bold leading-none tracking-[-0.06em]" style={{ color: ink, opacity: 0.9 }}>{String(year).slice(2)}</span>}
      <div className={`absolute inset-x-[8%] ${layout === 4 ? "top-[8%]" : "bottom-[7%]"}`} style={{ color: layout === 3 ? ink : "#f4f1ea" }}>
        <p className={`${latin ? "tracking-[0.04em]" : "tracking-[0.02em]"} text-[clamp(11px,1.35vw,20px)] font-bold leading-[1.05]`}>{title}</p>
        <div className="mt-[6%] h-px w-1/3" style={{ background: "currentColor", opacity: 0.5 }} />
        <p className="mt-[5%] text-[clamp(7px,0.65vw,10px)] uppercase tracking-[0.18em] opacity-70">{credit}  {year}</p>
      </div>
    </div>
  );
});

/** A stable seed for a name, so a file always gets the same poster. */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return Math.abs(hash) % 100_000;
}

/** A generated poster carrying a real title: for files and folders with no picture. */
export const NamedPoster = memo(function NamedPoster({ title, caption }: { title: string; caption: string }) {
  const poster = makePoster(seedOf(title));
  const { layout, ink } = poster;
  return (
    <div className="absolute inset-0 overflow-hidden" style={poster.style}>
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
      {layout === 3 && <span className="absolute left-[8%] top-[5%] text-[clamp(26px,3.6vw,52px)] font-bold leading-none tracking-[-0.06em]" style={{ color: ink, opacity: 0.9 }}>{String(poster.year).slice(2)}</span>}
      <div className={`absolute inset-x-[9%] ${layout === 4 ? "top-[9%]" : "bottom-[8%]"}`} style={{ color: layout === 3 ? ink : "#f4f1ea" }}>
        <p className="line-clamp-3 break-all text-[clamp(13px,1.25vw,19px)] font-bold leading-[1.08] tracking-[0.01em]">{title}</p>
        <div className="mt-[7%] h-px w-1/3" style={{ background: "currentColor", opacity: 0.5 }} />
        <p className="mt-[6%] truncate text-[10px] uppercase tracking-[0.16em] opacity-70">{caption}</p>
      </div>
    </div>
  );
});

function useColumns(): number {
  const pick = (): number => (innerWidth < 640 ? 7 : innerWidth < 1100 ? 9 : 10);
  const [count, setCount] = useState(pick);
  useEffect(() => {
    const onResize = (): void => setCount(pick());
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  return count;
}

/**
 * Smoothness guard: after the intro, time 45 frames. A machine that cannot keep
 * the drifting columns near 60 fps (no GPU compositing, battery saver) gets a
 * still wall instead of a stuttering one.
 */
function useCanDrift(enabled: boolean): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const times: number[] = [];
    let last = 0;
    const start = window.setTimeout(() => {
      const tick = (now: number): void => {
        if (last) times.push(now - last);
        last = now;
        if (times.length < 45) { frame = requestAnimationFrame(tick); return; }
        times.sort((a, b) => a - b);
        if (times[Math.floor(times.length / 2)] > 28) setOk(false);
      };
      frame = requestAnimationFrame(tick);
    }, 1900);
    return () => { clearTimeout(start); cancelAnimationFrame(frame); };
  }, [enabled]);
  return ok;
}

export function PosterWall({ leaving = false }: { leaving?: boolean }) {
  const reduced = useReducedMotionConfig();
  const drift = useCanDrift(!reduced) && !reduced;
  const columns = useColumns();
  const perColumn = columns <= 7 ? 7 : 8;
  const data = useMemo(() => Array.from({ length: columns }, (_, c) => Array.from({ length: perColumn }, (_, i) => makePoster(c * 97 + i * 13))), [columns, perColumn]);

  // The plane leans toward the pointer (desktop) a few degrees, on a soft spring.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 18 });
  const sy = useSpring(py, { stiffness: 40, damping: 18 });
  const rotateX = useTransform(sy, [-1, 1], [24, 14]);
  const rotateZ = useTransform(sx, [-1, 1], [-15, -9]);
  useEffect(() => {
    if (reduced) return;
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      px.set(event.clientX / innerWidth * 2 - 1);
      py.set(event.clientY / innerHeight * 2 - 1);
    };
    addEventListener("pointermove", onMove);
    return () => removeEventListener("pointermove", onMove);
  }, [px, py, reduced]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-void [--poster-w:118px] sm:[--poster-w:clamp(150px,13vw,230px)]" aria-hidden style={{ perspective: "1400px" }}>
      <motion.div
        className="absolute left-1/2 top-1/2 flex gap-[clamp(10px,1.4vw,22px)]"
        style={{ width: `calc(${columns} * var(--poster-w) + ${columns - 1} * clamp(10px, 1.4vw, 22px))`, x: "-50%", y: "-50%", rotateX: drift ? rotateX : 18, rotateZ: drift ? rotateZ : -12, transformStyle: "preserve-3d" }}
        initial={{ scale: 1.25, opacity: 0 }}
        animate={leaving ? { scale: 2.1, opacity: 0, transition: { duration: 0.75, ease: [0.5, 0, 0.75, 0] } } : { scale: 1.05, opacity: 1, transition: { duration: 1.6, ease: [0.16, 1, 0.3, 1] } }}
      >
        {data.map((posters, c) => {
          const duration = 46 + ((c * 17) % 5) * 9;
          const up = c % 2 === 0;
          return (
            <motion.div
              key={c}
              className="flex w-[var(--poster-w)] shrink-0 flex-col"
              initial={{ y: up ? 260 : -260, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 1.4, delay: 0.08 * c, ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                className="flex flex-col gap-[clamp(10px,1.4vw,22px)] pb-[clamp(10px,1.4vw,22px)] will-change-transform"
                style={drift ? { animation: `wall-${up ? "up" : "down"} ${duration}s linear infinite` } : undefined}
              >
                {[...posters, ...posters].map((poster, i) => <PosterCard key={i} poster={poster} />)}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
      {/* Vignette and floor fade: the wall sinks into the page colour at the edges. */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 85% 75% at 50% 45%, transparent 30%, rgb(7 7 8 / 0.85) 100%)" }} />
      <div className="absolute inset-0 max-sm:hidden" style={{ background: "linear-gradient(90deg, rgb(7 7 8 / 0.82) 0%, rgb(7 7 8 / 0.45) 38%, transparent 62%)" }} />
      <div className="absolute inset-0 sm:hidden" style={{ background: "linear-gradient(180deg, rgb(7 7 8 / 0.15) 0%, rgb(7 7 8 / 0.7) 22%, rgb(7 7 8 / 0.7) 42%, transparent 52%)" }} />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-void via-void/80 to-transparent sm:h-[45%]" />
    </div>
  );
}
