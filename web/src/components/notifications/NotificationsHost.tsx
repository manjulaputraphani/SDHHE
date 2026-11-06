/**
 * The notification host (Phase 15, fixed in the Phase 15 fix).
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
 *
 * The welcome banner is different from the rest: it is NOT due on every page
 * load. It only shows when `justLoggedIn` is true — a one-time flag that the
 * login success handler set (sessionStorage, consumed on the first read), and
 * only when the member's `showWelcomeBanner` setting is on. The card sits
 * fixed in the top-right and auto-hides after 6 s.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type NotificationBootstrap } from "../../api";
import { consumeWelcomeFlag } from "../../../../src/logic/welcomeBanner";
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
  // The one-time login flag — consumed on mount, never on a refresh.
  const [justLoggedIn] = useState(() => consumeWelcomeFlag());
  const [welcomeVisible, setWelcomeVisible] = useState(false);
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

  // The welcome card: only right after a real login AND only when the member
  // has the setting on. Once hidden it stays hidden for the rest of the tab.
  useEffect(() => {
    if (!data) return;
    if (justLoggedIn && (data.user.showWelcomeBanner ?? true)) {
      setWelcomeVisible(true);
    }
  }, [data, justLoggedIn]);

  const hideWelcome = useCallback(() => setWelcomeVisible(false), []);

  /** "Don't show again" — persisted in Neon, so it applies on every device. */
  const dontShowAgain = useCallback(() => {
    setWelcomeVisible(false);
    setData((current) =>
      current ? { ...current, user: { ...current.user, showWelcomeBanner: false } } : current,
    );
    void api.setWelcomeBanner(false).catch(() => undefined);
    showToast("The welcome message is switched off", "info", 3000);
  }, []);

  if (!data) return null;

  const announcements = data.announcements.filter((item) => !dismissed.includes(item.id));
  const announcement = announcements[0] ?? null;
  const showOnboarding =
    !data.onboarding.completed &&
    !onboardingSkipped &&
    data.onboarding.done < data.onboarding.total;

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

      {/* 2. what is new — once per member per release (marked seen in the DB) */}
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

      {/* 3. the checklist, 4. the announcement — both only while due */}
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

      {/* 5. the welcome card — fixed top-right, auto-hides after 6 s, only
          right after a real login and only when the setting is on */}
      {welcomeVisible && (
        <div className="pointer-events-none fixed right-3 top-3 z-40 md:right-5 md:top-5">
          <div className="pointer-events-auto">
            <WelcomeBanner
              name={data.user.name}
              lastLoginAt={data.user.lastLoginAt}
              onDismiss={hideWelcome}
              onDontShowAgain={dontShowAgain}
            />
          </div>
        </div>
      )}

      {/* the tour */}
      {tour && <ProductTour tour={tour} onDone={finishTour} onSkip={finishTour} />}
    </>
  );
}
