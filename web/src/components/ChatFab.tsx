import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getUnread, subscribeUnread } from "../unread";
import { IconMessageCircle } from "./icons";

/**
 * The floating "open chat" button — fixed bottom-right, on every screen except
 * Team Chat / Login / Register. The badge shows the total unread; it pulses
 * once when a new message lands and hides while the phone keyboard is open.
 */
export default function ChatFab({ onOpen }: { onOpen: () => void }) {
  const unread = useSyncExternalStore(subscribeUnread, getUnread, getUnread);
  const total = unread.total;
  const [pulsing, setPulsing] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const prevTotal = useRef(total);

  useEffect(() => {
    if (total > prevTotal.current) {
      setPulsing(true);
      const timer = window.setTimeout(() => setPulsing(false), 600);
      prevTotal.current = total;
      return () => window.clearTimeout(timer);
    }
    prevTotal.current = total;
  }, [total]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (!window.matchMedia("(max-width: 767px)").matches) {
        setKeyboardOpen(false);
        return;
      }
      setKeyboardOpen(window.innerHeight - vv.height > 120);
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return (
    <button
      type="button"
      aria-label={`Open the chat${total > 0 ? `, ${total} unread messages` : ""}`}
      onClick={onOpen}
      className={`chat-fab ${pulsing ? "chat-fab-pulse" : ""} ${keyboardOpen ? "chat-fab-hidden" : ""}`}
    >
      <IconMessageCircle size={26} />
      {total > 0 && <span className="chat-fab-badge">{total > 99 ? "99+" : total}</span>}
    </button>
  );
}
