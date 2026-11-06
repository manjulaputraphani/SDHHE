/**
 * What device is signing in? (Phase 15)
 *
 * A tiny User-Agent reader — enough for "Chrome on Windows" in the login
 * history and in the "new login" alert. No dependency.
 */
export type DeviceInfo = {
  device: string;
  browser: string;
  os: string;
};

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return { device: "Unknown device", browser: "Unknown browser", os: "Unknown OS" };

  const browser = /edg\//.test(ua)
    ? "Edge"
    : /opr\//.test(ua) || /opera/.test(ua)
      ? "Opera"
      : /samsungbrowser/.test(ua)
        ? "Samsung Internet"
        : /chrome\//.test(ua)
          ? "Chrome"
          : /firefox\//.test(ua)
            ? "Firefox"
            : /safari\//.test(ua)
              ? "Safari"
              : /curl\//.test(ua)
                ? "curl"
                : "Unknown browser";

  const os = /android/.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/.test(ua)
      ? "iOS"
      : /windows/.test(ua)
        ? "Windows"
        : /mac os x|macintosh/.test(ua)
          ? "macOS"
          : /linux/.test(ua)
            ? "Linux"
            : "Unknown OS";

  const device = /mobile|android|iphone|ipod/.test(ua)
    ? "Phone"
    : /ipad|tablet/.test(ua)
      ? "Tablet"
      : "Computer";

  return { device, browser, os };
}
