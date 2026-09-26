/** Fixed, decorative night sky (stars + crescent moon) behind a page. */
export function Sky({ moon = true }: { moon?: boolean }) {
  return (
    <div className="mb-sky" aria-hidden="true">
      {moon && <div className="mb-moon" />}
    </div>
  );
}
