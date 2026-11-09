/**
 * WhatsApp-style notification sound, synthesized with the Web Audio API.
 *
 * No external file — a short two-tone chime (880 Hz → 1320 Hz) with a quick
 * fade-out, so it works offline and never needs a network fetch.
 *
 * Call `playNotificationSound()` whenever a new message arrives while the
 * app is open (socket "message" frame, or a push event relayed from the
 * service worker).
 */
let audioCtx: AudioContext | null = null;

function ensureCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

/** Resume the context (browsers block audio until the first user gesture). */
function resumeCtx(): void {
  const ctx = ensureCtx();
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

/** Play one tone. */
function tone(ctx: AudioContext, freq: number, durationSec: number, whenSec: number): void {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  const now = ctx.currentTime;
  const start = Math.max(now, whenSec);
  const gainParam: AudioParam = gainNode.gain;
  gainParam.setValueAtTime(0.15, start);
  gainParam.exponentialRampToValueAtTime(0.001, start + durationSec);
  osc.start(start);
  osc.stop(start + durationSec);
}

/** WhatsApp-style two-tone chime. */
export function playNotificationSound(): void {
  try {
    resumeCtx();
    const ctx = ensureCtx();
    const now = ctx.currentTime;
    tone(ctx, 880, 0.12, now);
    tone(ctx, 1320, 0.18, now + 0.12);
  } catch {
    // Audio not available or blocked — silent failure is fine.
  }
}
