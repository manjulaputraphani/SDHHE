/**
 * Group info / Contact info — the new full-screen page (mobile, max-width
 * 767px ONLY). WhatsApp style: big avatar, quick actions, settings rows and
 * (for groups) the member list + Exit group.
 *
 * The Notifications row uses the SAME push setting as the header pill
 * (usePushToggle) and the AI polish row drives the SAME per-group setting as
 * the desktop menu — desktop and mobile stay in sync.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { usePushToggle } from "./notifications/PushToggle";
import { showToast } from "./notifications/toastStore";
import {
  IconArrowLeft,
  IconBell,
  IconImage,
  IconMic,
  IconSearch,
  IconSignOut,
  IconSparkles,
  IconUserPlus,
  IconUsers,
  IconVideo,
} from "./icons";

export type GroupInfoMember = {
  id: number;
  name: string;
  role: string;
  online: boolean;
};

function Switch({
  on,
  busy,
  onToggle,
  label,
}: {
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      className={`switch tap-44 ${on ? "switch--on" : ""}`}
      onClick={onToggle}
    >
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}

export default function GroupInfo({
  mode,
  name,
  avatarInitials,
  subtitle,
  members,
  currentUserId,
  contactId,
  mediaCount,
  aiPolish,
  canEditAiPolish,
  onToggleAiPolish,
  canAddMember,
  onAddMember,
  onSearch,
  onBack,
  onExit,
}: {
  mode: "group" | "contact";
  name: string;
  avatarInitials: string | null;
  /** "Group · 5 members" — or the phone for a contact. */
  subtitle: string;
  members: GroupInfoMember[];
  currentUserId: number;
  /** The other person of a 1:1 chat (for their phone number). */
  contactId?: number | null;
  mediaCount: number;
  aiPolish: boolean;
  canEditAiPolish: boolean;
  onToggleAiPolish: () => void;
  canAddMember: boolean;
  onAddMember: () => void;
  onSearch: () => void;
  onBack: () => void;
  onExit: () => void;
}) {
  const push = usePushToggle();
  const [confirmExit, setConfirmExit] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);

  // A 1:1 contact's phone — the team list has it (hidden when not allowed).
  useEffect(() => {
    if (mode !== "contact" || contactId == null) return;
    let stopped = false;
    api
      .users()
      .then(({ users }) => {
        if (!stopped) {
          setPhone(users.find((entry) => entry.id === contactId)?.phone ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [mode, contactId]);

  return (
    <section className="info-page">
      <header className="info-page__header">
        <button type="button" className="chat-header__icon tap-44" aria-label="Back" onClick={onBack}>
          <IconArrowLeft size={22} />
        </button>
        <h2 className="text-base font-semibold text-ink">{mode === "group" ? "Group info" : "Contact info"}</h2>
      </header>

      <div className="thin-scrollbar info-page__body">
        <div className="info-page__hero">
          <span className="info-page__avatar">{avatarInitials ?? <IconUsers size={30} />}</span>
          <p className="info-page__name">{name}</p>
          <p className="info-page__subtitle">{subtitle}</p>
          {mode === "contact" && phone && <p className="info-page__phone">{phone}</p>}
        </div>

        <div className="info-page__actions">
          <button type="button" className="info-page__action tap-44" onClick={() => showToast("Voice calls aren't available yet", "info")}>
            <IconMic size={20} />
            <span>Voice</span>
          </button>
          <button type="button" className="info-page__action tap-44" onClick={() => showToast("Video calls aren't available yet", "info")}>
            <IconVideo size={20} />
            <span>Video</span>
          </button>
          <button type="button" className="info-page__action tap-44" onClick={onSearch}>
            <IconSearch size={20} />
            <span>Search</span>
          </button>
        </div>

        <div className="info-page__card">
          <div className="info-page__row">
            <span className="info-page__rowicon">
              <IconBell size={18} />
            </span>
            <span className="info-page__rowtext">Notifications</span>
            <Switch on={push.on} busy={push.busy} onToggle={push.toggle} label="Notifications" />
          </div>
          {mode === "group" && (
            <div className="info-page__row">
              <span className="info-page__rowicon">
                <IconSparkles size={18} />
              </span>
              <span className="info-page__rowtext">
                AI polish
                {canEditAiPolish ? "" : " (owner only)"}
              </span>
              {canEditAiPolish ? (
                <Switch on={aiPolish} onToggle={onToggleAiPolish} label="AI polish" />
              ) : (
                <span className={`switch ${aiPolish ? "switch--on" : ""} switch--static`}>
                  <span className="switch__track">
                    <span className="switch__thumb" />
                  </span>
                </span>
              )}
            </div>
          )}
          <button type="button" className="info-page__row tap-44" onClick={onSearch}>
            <span className="info-page__rowicon">
              <IconImage size={18} />
            </span>
            <span className="info-page__rowtext">Media, links and docs</span>
            <span className="info-page__count">{mediaCount}</span>
          </button>
        </div>

        {mode === "group" && (
          <>
            <p className="info-page__sectionlabel">{members.length} MEMBERS</p>
            <div className="info-page__card">
              {canAddMember && (
                <button type="button" className="info-page__row tap-44" onClick={onAddMember}>
                  <span className="info-page__rowicon info-page__rowicon--accent">
                    <IconUserPlus size={18} />
                  </span>
                  <span className="info-page__rowtext">Add member</span>
                </button>
              )}
              {members.map((member) => (
                <div key={member.id} className="info-page__row">
                  <span className="info-page__memberavatar">
                    {(member.name.trim()[0] ?? "?").toUpperCase()}
                    {member.online && <span className="info-page__dot" aria-label="Online" />}
                  </span>
                  <span className="info-page__rowtext">
                    {member.name}
                    {member.id === currentUserId ? " (You)" : ""}
                  </span>
                  {member.role === "owner" ? (
                    <span className="info-page__tag">Owner</span>
                  ) : member.role === "ca" ? (
                    <span className="info-page__tag">Admin</span>
                  ) : null}
                </div>
              ))}
            </div>

            {!confirmExit ? (
              <button type="button" className="info-page__row info-page__exit tap-44" onClick={() => setConfirmExit(true)}>
                <span className="info-page__rowicon">
                  <IconSignOut size={18} />
                </span>
                <span className="info-page__rowtext">Exit group</span>
              </button>
            ) : (
              <div className="info-page__card info-page__confirm">
                <p className="text-sm text-ink">Leave {name}?</p>
                <div className="info-page__confirmrow">
                  <button type="button" className="btn-mini" onClick={() => setConfirmExit(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-mini bg-error-soft text-error-ink"
                    onClick={() => {
                      setConfirmExit(false);
                      onExit();
                    }}
                  >
                    Exit group
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
