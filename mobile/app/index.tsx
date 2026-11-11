/**
 * The Android launcher and deep links land on "/" — on a cold start the URL
 * comes in as `sdhhe:///`. Without this file Expo Router had no match for "/"
 * and showed its "Unmatched route — Page not found" screen.
 *
 * Signed-out users never render this screen: the root layout redirects to
 * /login first (and when Cloudflare Access returns in Phase 5, to
 * /access-setup). Signed-in users land on the Dashboard, matching the web
 * app's always-open-on-Dashboard rule.
 */
import { Redirect } from "expo-router";

export default function Index() {
  // The (tabs)/home screen is the route "/home".
  return <Redirect href="/home" />;
}
