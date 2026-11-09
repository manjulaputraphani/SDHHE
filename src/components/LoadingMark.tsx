/**
 * The round loading mark — the app's cup tile, shown while a screen loads.
 *
 * A deep espresso tile (#3E2A1F), a caramel inner circle (#C68A4E) and a
 * cream cup (#F3E6D2) with two steaming wisps. The steam breathes and the
 * tile pulses gently (both stop for prefers-reduced-motion — see the
 * `.loading-mark` rules in the app's stylesheet).
 *
 * Shared by the web app and the desktop app — one mark, one look.
 */
export default function LoadingMark({
  label = "Loading…",
  className = "",
}: {
  /** The line under the mark (null = the mark alone). */
  label?: string | null;
  className?: string;
}) {
  return (
    <div className={`loading-mark ${className}`} role="status" aria-live="polite">
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle cx="32" cy="32" r="30" fill="#3E2A1F" />
        <circle cx="32" cy="35" r="18" fill="#C68A4E" />
        <path
          className="loading-mark__steam"
          d="M27 17.5c-1.3 1.7-.6 3 0 3.9"
        />
        <path
          className="loading-mark__steam loading-mark__steam--2"
          d="M34 16c-1.3 1.7-.6 3 0 3.9"
        />
        <path d="M20 27h20v9.5a8.5 8.5 0 0 1-8.5 8.5h-3a8.5 8.5 0 0 1-8.5-8.5V27Z" fill="#F3E6D2" />
        <path
          d="M40.5 29.5h1.8a4.6 4.6 0 0 1 0 9.2h-1.8"
          stroke="#F3E6D2"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M16.5 48.5h25" stroke="#F3E6D2" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  );
}
