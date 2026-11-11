/**
 * Push notifications for the native app (Phase 18).
 *
 * The native app cannot use the browser's Web Push stack — it registers an
 * Expo push token instead, the worker stores it per member (push_tokens) and
 * fans chat messages out through the Expo Push API next to the browser push.
 *
 * Android 13+ shows the permission prompt only after a notification channel
 * exists, so the channel is created FIRST (per the SDK 58 guide). Everything
 * is best effort: without Firebase/FCM credentials uploaded for this build,
 * getExpoPushTokenAsync fails — chat keeps working, and push lights up once
 * the owner uploads the key (Phase 18, see HANDOVER).
 */
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

// Push arrives while the app is open → still show a banner with sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Ask for the notification permission and register the device's token. */
export async function enableMobilePush(): Promise<void> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return; // declined — chat still works, no pushes

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("team-chat", {
        name: "Team chat",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
      });
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return;
    await api.registerPushToken(token);
  } catch (e) {
    // No FCM credentials uploaded yet (Phase 18) or offline — harmless.
    console.log("push registration unavailable:", String(e).slice(0, 200));
  }
}
