/**
 * The product tour (Phase 15, component 6).
 *
 * A spotlight that points at the real elements of the screen, with Next,
 * Back and Skip. It is written from scratch (no new dependency — ask before
 * adding one): a spot light over the target, a tooltip with the text and the
 * buttons.
 */
import { useEffect, useState } from "react";
import type { Tour } from "./tourSteps";

export default function ProductTour({
  tour,
  onDone,
  onSkip,
}: {
  tour: Tour;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = tour.steps[index];
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(
    null,
  );

  // Find the element of the step and put the spotlight over it.
  useEffect(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const element = document.querySelector(step.target);
    if (!element) {
      setRect(null);
      return;
    }
    const place = () => {
      const box = element.getBoundingClientRect();
      setRect({
        top: box.top - 6,
        left: box.left - 6,
        width: box.width + 12,
        height: box.height + 12,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const timer = window.setInterval(place, 500);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.clearInterval(timer);
    };
  }, [step?.target]);

  if (!step) return null;
  const last = index === tour.steps.length - 1;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={tour.name}>
      {/* the dimmed layer with the hole over the target */}
      <div className="absolute inset-0 bg-black/45" onClick={onSkip} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div className="absolute inset-x-3 bottom-4 mx-auto w-auto max-w-sm sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
        <div className="card space-y-3 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {tour.name} · {index + 1}/{tour.steps.length}
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-ink">{step.title}</h3>
            <p className="mt-1 text-sm text-muted">{step.text}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="btn-mini" onClick={onSkip}>
              Skip
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (last) onDone();
                  else setIndex((value) => value + 1);
                }}
              >
                {last ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
