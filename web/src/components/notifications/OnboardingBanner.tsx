/**
 * The onboarding banner (Phase 15, component 2).
 *
 * The setup checklist for the members who have not finished it yet, with the
 * progress. It disappears for good when everything is done or when the member
 * clicks "Skip".
 */
export type OnboardingStep = { key: string; label: string; done: boolean };

export type OnboardingBannerProps = {
  steps: OnboardingStep[];
  done: number;
  total: number;
  onSkip: () => void;
  onGoTo?: (key: string) => void;
};

export default function OnboardingBanner({
  steps,
  done,
  total,
  onSkip,
  onGoTo,
}: OnboardingBannerProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="card space-y-3 p-4" role="region" aria-label="Getting started">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Get your shop ready</p>
          <p className="text-xs text-muted">
            {done} of {total} steps done — a small list to get started.
          </p>
        </div>
        <button type="button" className="btn-mini" onClick={onSkip}>
          Skip
        </button>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.key}>
            <button
              type="button"
              onClick={() => onGoTo?.(step.key)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className={`grid size-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                  step.done ? "border-secondary bg-secondary text-on-primary" : "border-line"
                }`}
              >
                {step.done ? "✓" : ""}
              </span>
              <span className={step.done ? "text-muted line-through" : "text-ink"}>{step.label}</span>
              <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
