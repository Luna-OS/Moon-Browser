import type { ReactNode } from "react";

/** The frame of the list pages (history, bookmarks, downloads): a title and a column. */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 px-6 pt-10 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <img src="/moon.svg" width={40} height={40} alt="" />
          <div>
            <h1 className="mb-title m-0 text-[1.75rem] leading-tight font-semibold">{title}</h1>
            {subtitle && <p className="m-0 mt-0.5 text-sm text-(--mb-text-muted)">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

/** A titled glass panel — the basic building block of every page. */
export function Card({
  title,
  id,
  description,
  children,
  className = "",
}: {
  title?: ReactNode;
  id?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mb-glass flex scroll-mt-6 flex-col ${className}`}>
      {title && (
        <header className="border-b border-(--mb-border) px-5 py-3.5">
          <h2 className="m-0 text-[0.95rem] font-semibold">{title}</h2>
          {description && (
            <p className="m-0 mt-0.5 text-xs text-(--mb-text-muted)">{description}</p>
          )}
        </header>
      )}
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/** One setting: label and explanation on the left, its control on the right. */
export function Row({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-(--mb-border) px-5 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {hint && (
          <div className="mt-0.5 text-xs leading-relaxed text-(--mb-text-muted)">{hint}</div>
        )}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 border-b border-(--mb-border) px-5 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {hint && (
          <div className="mt-0.5 text-xs leading-relaxed text-(--mb-text-muted)">{hint}</div>
        )}
      </div>
      <input
        type="checkbox"
        className="mb-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** A segmented control: one choice out of a few, as toggle buttons. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 gap-0.5 rounded-[0.7rem] border border-(--mb-border) bg-(--mb-inset) p-0.5"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[0.55rem] border-0 px-3 text-xs font-medium transition-colors duration-150 ${
              selected
                ? "bg-(--mb-selected) text-(--mb-accent) shadow-[inset_0_0_0_1px_rgb(185_174_251/0.35)]"
                : "bg-transparent text-(--mb-text-muted) hover:text-(--mb-text)"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="m-0 font-medium">{title}</p>
      {children && <p className="m-0 max-w-sm text-sm text-(--mb-text-muted)">{children}</p>}
    </div>
  );
}
