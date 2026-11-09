/**
 * The mobile chat header (max-width 767px ONLY) — 56px, WhatsApp style:
 * back, avatar, name + one-line status, then Phone / Video / MoreVertical.
 * Tapping the avatar or the name opens Group info (Contact info for 1:1).
 */
import { useState } from "react";
import { showToast } from "./notifications/toastStore";
import {
  IconArrowLeft,
  IconMoreVertical,
  IconPhone,
  IconSearch,
  IconUsers,
  IconVideo,
} from "./icons";

export default function ChatHeader({
  name,
  subtitle,
  isGroup,
  avatarInitials,
  onBack,
  onOpenInfo,
  onSearch,
  muted,
  onToggleMute,
  onClearChat,
}: {
  name: string;
  subtitle: string;
  isGroup: boolean;
  avatarInitials: string | null;
  onBack: () => void;
  onOpenInfo: () => void;
  onSearch: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onClearChat: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="chat-header">
      <button type="button" className="chat-header__icon tap-44" aria-label="Back to chats" onClick={onBack}>
        <IconArrowLeft size={22} />
      </button>
      <button type="button" className="chat-header__who tap-44" onClick={onOpenInfo}>
        <span className="chat-header__avatar">
          {avatarInitials ? avatarInitials : <IconUsers size={18} />}
        </span>
        <span className="chat-header__names">
          <span className="chat-header__name">{name}</span>
          <span className="chat-header__status">{subtitle}</span>
        </span>
      </button>
      <div className="chat-header__actions">
        <button
          type="button"
          className="chat-header__icon tap-44"
          aria-label="Voice call"
          onClick={() => showToast("Voice calls aren't available yet", "info")}
        >
          <IconPhone size={19} />
        </button>
        <button
          type="button"
          className="chat-header__icon tap-44"
          aria-label="Video call"
          onClick={() => showToast("Video calls aren't available yet", "info")}
        >
          <IconVideo size={19} />
        </button>
        <div className="chat-header__menuwrap">
          <button
            type="button"
            className="chat-header__icon tap-44"
            aria-label="Chat menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconMoreVertical size={19} />
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
              />
              <div className="chat-header__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onSearch();
                  }}
                >
                  <IconSearch size={16} /> Search in chat
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenInfo();
                  }}
                >
                  <IconUsers size={16} /> {isGroup ? "Group info" : "Contact info"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleMute();
                  }}
                >
                  {muted ? "Unmute notifications" : "Mute notifications"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="chat-header__menu-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onClearChat();
                  }}
                >
                  Clear chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
