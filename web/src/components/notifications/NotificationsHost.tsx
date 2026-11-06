/**
 * The notification host (Phase 15).
 *
 * It collects everything that is due after a sign-in and shows it one thing at
 * a time, in this order:
 *
 *   1. the "signed in somewhere else" window
 *   2. the "what's new" window
 *   3. the onboarding checklist
 *   4. the announcement bar
 *   5. the welcome banner
 *
 * Only one modal is ever open.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type NotificationBootstrap } from "../../api";
import { showToast } from "./toastStore";
import AnnouncementBanner from "./AnnouncementBanner";
import LoginAlertModal from "./LoginAlertModal";
import OnboardingBanner from "./OnboardingBanner";
import ProductTour from "./ProductTour";
import WelcomeBanner from "./WelcomeBanner";
import WhatsNewModal from "./WhatsNewModal";
import { TOURS, type Tour } from "./tourSteps";

export type NotificationsHostProps = {
  /** The member signed in on another device (the old session was closed). */
  signedInElsewhere?: { browser?: string | null; os?: string | null; at?: string | null } | null;
  /** The tour the member asked for (Help → Take tour). */
  startTour?: string | null;
  onTourStarted?: () => void;
};

export default function NotificationsHost({
  signedInElsewhere,
  startTour,
  onTourStarted,
}: NotificationsHostProps) {
  const [data, setData] = useState<NotificationBootstrap | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const [tour, setTour] = useState<Tour | null>(null);

  // Load everything that is due.
  useEffect(() => {
    let stopped = false;
    api
      .notifications()
      .then((result) => {
        if (!stopped) setData(result);
      })
      .catch((err) => {
        if (!stopped) console.error(err);
      });
    return () => {
      stopped = true;
    };
  }, []);

  // A tour can be started from the menu ("Help → Take the tour").
  useEffect(() => {
    if (!startTour) return;
    const found = TOURS.find((entry) => entry.id === startTour);
    if (found) {
      setTour(found);
      onTourStarted?.();
    }
  }, [startTour, onTourStarted]);

  const dismissAnnouncement = useCallback((id: number) => {
    setDismissed((list) => [...list, id]);
    void api.dismissAnnouncement(id).catch(() => undefined);
  }, []);

  const skipOnboarding = useCallback(() => {
    setOnboardingSkipped(true);
    void api.completeOnboarding().catch(() => undefined);
  }, []);

  const finishTour = useCallback(() => {
    const id = tour?.id;
    setTour(null);
    if (id) void api.completeTour(id).catch(() => undefined);
  }, [tour?.id]);

  if (!data) return null;

  const announcements = data.announcements.filter((item) => !dismissed.includes(item.id));
  const announcement = announcements[0] ?? null;
  const showOnboarding =
    !data.onboarding.completed &&
    !onboardingSkipped &&
    data.onboarding.done < data.onboarding.total;
  const showWelcome = !welcomeDismissed;

  return (
    <>
      {/* 1. the old session was closed */}
      {signedInElsewhere && (
        <LoginAlertModal
          newLogin={signedInElsewhere}
          onClose={() => {
            showToast("Please sign in again", "info");
            window.location.reload();
          }}
        />
      )}

      {/* 2. what is new */}
      {data.release && (
        <WhatsNewModal
          release={data.release}
          onClose={() => {
            void api.markReleaseSeen(data.release!.id).catch(() => undefined);
            setData({ ...data, release: null });
          }}
          onTakeTour={() => {
            void api.markReleaseSeen(data.release!.id).catch(() => undefined);
            setData({ ...data, release: null });
            const first = TOURS[0];
            if (first) setTour(first);
          }}
        />
      )}

      {/* 3. the checklist, 4. the announcement, 5. the welcome */}
      {showOnboarding && (
        <OnboardingBanner
          steps={data.onboarding.steps}
          done={data.onboarding.done}
          total={data.onboarding.total}
          onSkip={skipOnboarding}
        />
      )}

      {announcement && (
        <AnnouncementBanner announcement={announcement} onDismiss={dismissAnnouncement} />
      )}

      {showWelcome && (
        <WelcomeBanner
          name={data.user.name}
          lastLoginAt={data.user.lastLoginAt}
          onDismiss={() => setWelcomeDismissed(true)}
        />
      )}

      {/* the tour */}
      {tour && <ProductTour tour={tour} onDone={finishTour} onSkip={finishTour} />}
    </>
  );
}
