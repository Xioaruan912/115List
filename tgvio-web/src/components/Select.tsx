import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Menu } from "./Menu";

/**
 * A dropdown in the app's own style instead of the browser's: a field-like
 * button, and the choices in the shared menu (a popover that grows out of the
 * button on desktop, a bottom sheet on phones), the current one ticked.
 */
export function Select<T extends string>({ value, options, onChange, disabled, label, className = "", width }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; width: number } | null>(null);
  const current = options.find(([key]) => key === value)?.[1] ?? value;
  const open = (): void => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ x: r.left, y: r.bottom + 6, width: Math.max(r.width, width ?? 0, 180) });
  };
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={!!at} onClick={open}
        className={`field flex items-center justify-between gap-2 text-left transition-[box-shadow,background-color] hover:bg-[var(--hover)] disabled:opacity-50 ${at ? "!shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]" : ""} ${className}`}>
        <span className="min-w-0 truncate">{current}</span>
        <CaretUpDownIcon size={14} className="shrink-0 text-faint" />
      </button>
      <Menu open={!!at} x={at?.x ?? 0} y={at?.y ?? 0} width={at?.width} onClose={() => setAt(null)}
        entries={options.map(([key, text]) => ({
          label: text,
          icon: key === value ? <CheckIcon size={14} weight="bold" className="text-accent-text" /> : <span className="size-3.5" />,
          run: () => { if (key !== value) onChange(key); },
        }))} />
    </>
  );
}
