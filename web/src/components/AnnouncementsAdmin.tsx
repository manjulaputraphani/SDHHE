/**
 * The announcement admin (Phase 15, component 3).
 *
 * The owner creates, edits, schedules and deactivates the announcements, and
 * publishes a release (which tells the whole team: everybody is signed out so
 * they see the "what's new" window the next time they sign in).
 */
import { useEffect, useState } from "react";
import { api, type Announcement, type AnnouncementKind } from "../api";
import { showToast } from "./notifications/toastStore";

const KINDS: AnnouncementKind[] = ["info", "success", "warning", "critical"];

export default function AnnouncementsAdmin() {
  const [list, setList] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<AnnouncementKind>("info");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [releaseVersion, setReleaseVersion] = useState("");
  const [releaseTitle, setReleaseTitle] = useState("");
  const [releaseItems, setReleaseItems] = useState("");

  const load = () => {
    api
      .listAnnouncements()
      .then((result) => setList(result.announcements))
      .catch((err) => showToast(err instanceof Error ? err.message : String(err), "error"));
  };

  useEffect(load, []);

  async function create() {
    if (!title.trim() || !message.trim()) {
      showToast("A title and a message are needed", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.createAnnouncement({
        title: title.trim(),
        message: message.trim(),
        kind,
        linkLabel: linkLabel.trim() || undefined,
        linkUrl: linkUrl.trim() || undefined,
      });
      showToast("Announcement published", "success");
      setTitle("");
      setMessage("");
      setLinkLabel("");
      setLinkUrl("");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: number) {
    try {
      await api.deactivateAnnouncement(id);
      showToast("Announcement switched off", "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function publishRelease() {
    const items = releaseItems
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!releaseTitle.trim() || items.length === 0) {
      showToast("Give a title and at least one change", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.publishRelease({
        version: releaseVersion.trim() || "1.0",
        title: releaseTitle.trim(),
        items,
      });
      showToast("Published — everybody is signed out and sees the new features", "success");
      setReleaseVersion("");
      setReleaseTitle("");
      setReleaseItems("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">New announcement</h2>
          <p className="text-sm text-muted">
            It shows at the top of every page until a member closes it (or the end date passes).
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <select
            className="input"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as AnnouncementKind)}
            aria-label="The kind of the announcement"
          >
            {KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="input min-h-20 w-full"
          placeholder="The message"
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Link text (optional)"
            value={linkLabel}
            onChange={(event) => setLinkLabel(event.currentTarget.value)}
          />
          <input
            className="input"
            placeholder="Link address (optional)"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          Publish the announcement
        </button>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Announcements</h2>
          <p className="text-sm text-muted">The live ones are shown to everybody.</p>
        </div>
        <ul className="space-y-2">
          {list.length === 0 && <li className="text-sm text-muted">Nothing published yet.</li>}
          {list.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3"
            >
              <span className={`badge badge-${item.kind === "critical" ? "bad" : item.kind === "success" ? "ok" : item.kind === "warning" ? "warn" : "info"}`}>
                {item.kind}
              </span>
              <span className="min-w-0 flex-1 text-sm text-ink">{item.title}</span>
              {item.isActive ? (
                <button type="button" className="btn-mini" onClick={() => void deactivate(item.id)}>
                  Switch off
                </button>
              ) : (
                <span className="badge">off</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Publish a release ("what's new")</h2>
          <p className="text-sm text-muted">
            Every member is signed out, so the next sign-in shows them the new features — once.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Version (e.g. 1.2)"
            value={releaseVersion}
            onChange={(event) => setReleaseVersion(event.currentTarget.value)}
          />
          <input
            className="input"
            placeholder="Title (e.g. Team Chat is here)"
            value={releaseTitle}
            onChange={(event) => setReleaseTitle(event.currentTarget.value)}
          />
        </div>
        <textarea
          className="input min-h-24 w-full"
          placeholder={"One change per line:\nTeam chat with receipts\nDelivered and read ticks"}
          value={releaseItems}
          onChange={(event) => setReleaseItems(event.currentTarget.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void publishRelease()}
        >
          Publish and sign everybody out
        </button>
      </section>
    </div>
  );
}
