import { useMemo } from "react";

/**
 * The "📲 Install the Android app" button — used by the desktop sidebar, the
 * mobile drawer, and the More sheet (all gated on an Android user-agent).
 *
 * Why it is not just a plain <a download>: on phones that still have the old
 * home-screen shortcut (installed while the site was a PWA, before 2026-11-11),
 * Chrome BLOCKS APK downloads from inside that standalone window — the tap
 * appears to do nothing, so people think the PWA re-installed itself. When we
 * detect that case we explain it: open the site in Chrome instead. The real
 * native TWA (com.sdhhe.app) announces itself in document.referrer, so it is
 * not nagged — its own download works (it installs as an update).
 */

const TWA_REFERRER = "android-app://com.sdhhe.app";

type StandaloneWindow = Navigator & { standalone?: boolean };

export default function AndroidAppInstall({
  className,
  hintClassName,
}: {
  className: string;
  /** Theme of the hint line differs between the sidebar (nav-*) and More sheet (ink). */
  hintClassName: string;
}) {
  const legacyShortcut = useMemo(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as StandaloneWindow).standalone === true;
    // Standalone + NOT our native app = the old PWA shortcut.
    return standalone && document.referrer !== TWA_REFERRER;
  }, []);

  return (
    <>
      <a href="/sdhhe.apk" download="SDHHE.apk" className={className}>
        📲 Install the Android app
      </a>
      {legacyShortcut && (
        <p className={hintClassName}>
          Nothing happens? This icon is the old browser shortcut and Android
          blocks installs from inside it — open the site in Chrome instead.
        </p>
      )}
    </>
  );
}
