import { isStockLogo, markLetter } from "../lib/brand";
import { useSession } from "../stores/session";

/** The site mark: a custom logo when one is set, otherwise the title's first letter on the accent. */
export function Mark({ className = "", rounded = "rounded-[10px]" }: { className?: string; rounded?: string }) {
  const settings = useSession(state => state.settings);
  const logo = settings.logo?.split("\n")[0]?.trim();
  if (!isStockLogo(logo)) return <img src={logo} alt="" className={`${className} ${rounded} object-contain`} />;
  return (
    <span className={`grid place-items-center bg-accent font-bold leading-none text-accent-ink ${rounded} ${className}`} aria-hidden>
      {markLetter(settings.site_title)}
    </span>
  );
}
