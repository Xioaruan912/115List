import { useReducedMotion } from "motion/react";

/**
 * A heading whose characters rise into place one after another. Plain CSS
 * animations on inline spans: cheap, and the key on the parent replays it when
 * the text changes. Long titles animate per word instead of per character.
 */
export function SplitText({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className}>{text}</span>;
  const chars = [...text];
  const parts = chars.length > 42 ? text.split(/(\s+)/) : chars;
  return (
    <span className={className} aria-label={text}>
      {parts.map((part, index) => (
        <span key={index} aria-hidden className="inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em]">
          <span
            className="inline-block whitespace-pre"
            style={{
              animation: `split-rise 700ms cubic-bezier(0.16,1,0.3,1) both`,
              animationDelay: `${delay + Math.min(index, 30) * 24}ms`,
            }}
          >
            {part}
          </span>
        </span>
      ))}
    </span>
  );
}
