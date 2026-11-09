/**
 * WhatsApp-style notification feedback for the native mobile chat.
 *
 * The native push notification plays the OS sound automatically. Inside the
 * app (when the socket delivers a message directly), we vibrate to give a
 * physical cue — using React Native's built-in Vibration API (no extra
 * dependency needed).
 */
import { Vibration } from "react-native";

/** A short vibrate to signal an incoming message while the app is open. */
export function playNotificationSound(): void {
  try {
    Vibration.vibrate(30);
  } catch {
    // Haptics not supported on this device — silent failure is fine.
  }
}

/** A longer double-buzz for a new push notification. */
export async function playSound(): Promise<void> {
  try {
    Vibration.vibrate([0, 40, 100, 40]);
  } catch {
    // Not supported.
  }
}
