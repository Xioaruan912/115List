import postcss, { type Plugin as PostcssPlugin } from "postcss";
import presetEnv from "postcss-preset-env";
import type { Plugin } from "vite";

// Old browser cores (Chrome < 99, as in 360 / QQ / Sogou on older builds) drop
// every rule inside @layer, so Tailwind v4's stylesheet does nothing there and
// the page shows as bare HTML. Next to each built stylesheet this writes a
// "<name>.legacy.css" with the layers flattened and newer CSS lowered; a tiny
// script in index.html swaps to it only when the browser lacks @layer, so
// current browsers keep the original file untouched.

const LEGACY_BROWSERS = ["chrome 70", "firefox 68", "safari 12"];

// Tailwind writes `translate`, `scale` and `rotate` as their own properties
// (Chrome 104+). Old cores need them folded into `transform`.
const individualTransforms: PostcssPlugin = {
  postcssPlugin: "tgvio-individual-transforms",
  Declaration(decl) {
    const v = decl.value.trim();
    const pair = (fn: string) => {
      const parts = v.split(/\s+(?![^(]*\))/);
      return `${fn}(${parts.join(", ")})`;
    };
    if (decl.prop === "translate" && v !== "none") {
      decl.cloneBefore({ prop: "transform", value: pair("translate") });
    } else if (decl.prop === "scale" && v !== "none") {
      decl.cloneBefore({ prop: "transform", value: pair("scale") });
    } else if (decl.prop === "rotate" && v !== "none" && !/\s/.test(v)) {
      decl.cloneBefore({ prop: "transform", value: `rotate(${v})` });
    }
  },
};

// Tailwind only gives its --tw-* defaults to browsers without @property behind
// an @supports test that matches Safari and Firefox; old Chromium needs them too.
// dvh/svh/lvh units (Chrome 108+) get a vh value in front. :where() (Chrome 88+)
// becomes :is(), which preset-env then expands; the extra specificity is harmless.
// Elements that hide their scrollbar get the ::-webkit-scrollbar rule too.
const oldCoreFallbacks: PostcssPlugin = {
  postcssPlugin: "tgvio-old-core-fallbacks",
  AtRule: {
    supports(rule) {
      if (rule.params.includes("margin-trim:inline") || rule.params.includes("margin-trim: inline")) {
        rule.replaceWith(rule.nodes ?? []);
      }
    },
  },
  Rule(rule) {
    if (rule.selector.includes(":where(")) rule.selector = rule.selector.replaceAll(":where(", ":is(");
  },
  Declaration(decl) {
    // scrollbar-width (Chrome 121+): hide WebKit scrollbars the old way.
    if (decl.prop === "scrollbar-width" && decl.value === "none" && decl.parent?.type === "rule") {
      const rule = decl.parent as import("postcss").Rule;
      rule.after(postcss.rule({ selector: rule.selectors.map(sel => `${sel}::-webkit-scrollbar`).join(","), nodes: [postcss.decl({ prop: "display", value: "none" })] }));
    }
    if (/\d[dsl]vh\b/.test(decl.value)) {
      decl.cloneBefore({ value: decl.value.replace(/(\d)[dsl]vh\b/g, "$1vh") });
    }
  },
};

// color-mix() (Chrome 111+) over a theme variable has no static fallback, so
// Tailwind falls back to the full colour: a faint red banner turns solid red.
// Resolve the variable per theme and write an rgba() rule for each.
const THEMES = ["dark", "light"] as const;

function parseColor(v: string): [number, number, number, number] | null {
  v = v.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  return null;
}

const themeColorMix: PostcssPlugin = {
  postcssPlugin: "tgvio-theme-color-mix",
  Once(root) {
    const vars: Record<string, Record<string, string>> = { base: {}, dark: {}, light: {} };
    root.walkRules(rule => {
      const theme = /data-theme="?dark/.test(rule.selector) ? "dark" : /data-theme="?light/.test(rule.selector) ? "light"
        : /^(:root|:host)/.test(rule.selector) ? "base" : null;
      if (!theme) return;
      rule.each(n => { if (n.type === "decl" && n.prop.startsWith("--")) vars[theme][n.prop] = n.value; });
    });
    const resolve = (theme: string, name: string, depth = 0): string | undefined => {
      const v = vars[theme][name] ?? vars.base[name];
      const ref = v && /^var\((--[\w-]+)\)$/.exec(v.trim());
      return ref && depth < 8 ? resolve(theme, ref[1], depth + 1) : v;
    };
    const mix = /color-mix\(in [\w-]+,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)/g;
    root.walkDecls(decl => {
      if (!decl.value.includes("color-mix(") || decl.parent?.type !== "rule") return;
      const rule = decl.parent as import("postcss").Rule;
      if (/data-theme/.test(rule.selector)) return;
      for (const theme of THEMES) {
        let ok = true;
        const value = decl.value.replace(mix, (_, name: string, pct: string) => {
          const c = parseColor(resolve(theme, name) ?? "");
          if (!c) { ok = false; return _; }
          return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+(c[3] * +pct / 100).toFixed(3)})`;
        });
        if (!ok || value.includes("color-mix(")) continue;
        const selector = rule.selectors.map(sel => `[data-theme="${theme}"] ${sel}`).join(",");
        let anchor: import("postcss").ChildNode = rule;
        while (anchor.parent && anchor.parent.type === "atrule" && (anchor.parent as import("postcss").AtRule).name === "supports") anchor = anchor.parent as import("postcss").AtRule;
        anchor.after(postcss.rule({ selector, nodes: [postcss.decl({ prop: decl.prop, value, important: decl.important })] }));
      }
    });
  },
};

export async function legacyCss(css: string): Promise<string> {
  const out = await postcss([
    themeColorMix,
    oldCoreFallbacks,
    presetEnv({
      browsers: LEGACY_BROWSERS,
      stage: 2,
      features: { "cascade-layers": true, "is-pseudo-class": true, "logical-properties-and-values": true },
    }),
    individualTransforms,
  ]).process(css, { from: undefined });
  return out.css;
}

export function legacyCssPlugin(): Plugin {
  return {
    name: "tgvio-legacy-css",
    apply: "build",
    async generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        const source = typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
        this.emitFile({ type: "asset", fileName: file.fileName.replace(/\.css$/, ".legacy.css"), source: await legacyCss(source) });
      }
    },
  };
}
