import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";
import { DbProvider } from "../lib/db-context";
import { deleteSecret, getSecret, hashPin, saveSecret, verifyPin } from "../lib/secrets";
import { getAuditActor, listActivity, logActivity } from "../db/activity";
import { createUser, listAppUsers, setUserActive } from "../db/users";
import { can } from "../db/permissions";

vi.mock("../db/client", () => ({
  getDb: vi.fn(() => ({})),
  getTxDb: vi.fn(),
  withTransaction: vi.fn(),
  pingDb: vi.fn(),
}));
vi.mock("../db/settings", () => ({
  DEFAULT_AI_CONFIG: { enabled: false, mode: "local", model: "glm-5.3-flash:cloud" },
  DEFAULT_SHOP: { name: "", address: "", phone: "", gstin: "" },
  getAiConfig: vi.fn(async () => ({ enabled: false, mode: "local", model: "glm-5.3-flash:cloud" })),
  saveAiConfig: vi.fn(async () => {}),
  DEFAULT_EMAIL: { fromEmail: "", fromName: "", host: "smtp.gmail.com", port: "465" },
  getEmailSettings: vi.fn(async () => ({ fromEmail: "shop@example.com", fromName: "SDHHE", host: "smtp.gmail.com", port: "465" })),
  saveEmailSettings: vi.fn(async () => {}),
  getShopDetails: vi.fn(async () => ({
    name: "SREE DURGA HARIHARA ENTERPRISES",
    shortName: "SDHHE",
    address: "",
    phone: "",
    email: "",
    gstin: "36ABCDE1234F1Z5",
    bankName: "",
    bankAccount: "",
    bankIfsc: "",
    bankBranch: "",
  })),
  saveShopDetails: vi.fn(async () => {}),
  getChatWorkerUrl: vi.fn(async () => "https://sdhhe-api.blvphani.workers.dev"),
  saveChatWorkerUrl: vi.fn(async () => {}),
}));
vi.mock("../lib/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/secrets")>();
  return {
    ...actual,
    getSecret: vi.fn(),
    saveSecret: vi.fn(),
    deleteSecret: vi.fn(),
    hashPin: vi.fn(),
    verifyPin: vi.fn(),
  };
});
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "1.0.0") }));
vi.mock("../ai/ollama", () => ({ chat: vi.fn() }));
vi.mock("../lib/email", () => ({ sendEmail: vi.fn(async () => {}), billEmailSubject: vi.fn() }));
vi.mock("../db/activity", () => ({
  listActivity: vi.fn(async () => []),
  logActivity: vi.fn(async () => {}),
  getAuditActor: vi.fn(() => ({ userId: 1, name: "Phani", role: "owner" })),
}));
vi.mock("../db/users", () => ({
  listAppUsers: vi.fn(async () => []),
  createUser: vi.fn(),
  resetUserPassword: vi.fn(async () => {}),
  setUserActive: vi.fn(async () => {}),
  setUserRole: vi.fn(async () => {}),
}));
vi.mock("../db/permissions", async () => {
  const { DEFAULT_ROLE_PERMISSIONS } = await import("../logic/permissions");
  return {
    can: vi.fn(() => true),
    getRoleMatrix: vi.fn(async () => DEFAULT_ROLE_PERMISSIONS),
    saveRolePermissions: vi.fn(async () => DEFAULT_ROLE_PERMISSIONS.ca),
  };
});

const URL = "postgresql://user:pass@localhost:5432/test";

function renderPage(onLock = vi.fn()) {
  render(
    <DbProvider url={URL}>
      <Settings onReset={vi.fn()} onLock={onLock} />
    </DbProvider>,
  );
  return onLock;
}

beforeEach(() => {
  vi.mocked(getSecret).mockReset().mockImplementation(async (key) =>
    key === "OLLAMA_API_KEY" ? null : "saved",
  );
  vi.mocked(saveSecret).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteSecret).mockReset().mockResolvedValue(undefined);
  vi.mocked(hashPin).mockReset().mockResolvedValue("$argon2id$new-hash");
  vi.mocked(verifyPin).mockReset().mockResolvedValue(true);
  vi.mocked(listActivity).mockReset().mockResolvedValue([]);
  vi.mocked(logActivity).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAuditActor).mockReturnValue({ userId: 1, name: "Phani", role: "owner" });
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(listAppUsers).mockReset().mockResolvedValue([
    { id: 1, name: "Phani", phone: "9876543210", role: "owner", active: true, pending: false, accessUntil: null },
    { id: 2, name: "Ravi", phone: "9123456780", role: "staff", active: true, pending: false, accessUntil: null },
  ]);
  vi.mocked(createUser).mockReset().mockResolvedValue({
    id: 3,
    name: "Priya",
    phone: "9000000000",
    role: "staff",
    active: true,
    pending: false,
    accessUntil: null,
  });
  vi.mocked(setUserActive).mockReset().mockResolvedValue(undefined);
});

describe("Settings — security", () => {
  it("shows what is stored in the keychain without revealing values", async () => {
    renderPage();
    expect(await screen.findByText(/PIN: set/)).toBeInTheDocument();
    expect(screen.getByText(/Database connection: saved/)).toBeInTheDocument();
    expect(screen.getByText(/AI cloud key: not saved/)).toBeInTheDocument();
    expect(screen.queryByText("saved", { exact: true })).not.toBeInTheDocument();
  });

  it("locks the app on 'Lock now'", async () => {
    const onLock = renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Lock now" }));
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "user.logout" }),
    );
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("lists recent activity with who and when", async () => {
    vi.mocked(listActivity).mockResolvedValue([
      {
        id: 1,
        at: new Date("2026-10-30T18:40:00Z"),
        actor: "local",
        event: "login",
        summary: "Unlocked the app",
      },
    ]);
    renderPage();
    expect(await screen.findByText("Unlocked the app")).toBeInTheDocument();
    expect(screen.getByText(/· local$/)).toBeInTheDocument();
  });

  it("changes the PIN after checking the current one", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/PIN: set/);

    await user.type(screen.getByLabelText("Current PIN"), "1234");
    await user.type(screen.getByLabelText("New PIN"), "5678");
    await user.type(screen.getByLabelText("Confirm new PIN"), "5678");
    await user.click(screen.getByRole("button", { name: "Update PIN" }));

    expect(verifyPin).toHaveBeenCalledWith("1234", "saved");
    expect(hashPin).toHaveBeenCalledWith("5678");
    expect(saveSecret).toHaveBeenCalledWith("PIN_HASH", "$argon2id$new-hash");
    expect(await screen.findByText("PIN updated")).toBeInTheDocument();
  });

  it("refuses a wrong current PIN", async () => {
    vi.mocked(verifyPin).mockResolvedValue(false);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/PIN: set/);

    await user.type(screen.getByLabelText("Current PIN"), "0000");
    await user.type(screen.getByLabelText("New PIN"), "5678");
    await user.type(screen.getByLabelText("Confirm new PIN"), "5678");
    await user.click(screen.getByRole("button", { name: "Update PIN" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Current PIN is incorrect");
    expect(saveSecret).not.toHaveBeenCalled();
  });

  it("validates the new PIN format and match", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/PIN: set/);

    await user.type(screen.getByLabelText("Current PIN"), "1234");
    await user.type(screen.getByLabelText("New PIN"), "12");
    await user.type(screen.getByLabelText("Confirm new PIN"), "12");
    await user.click(screen.getByRole("button", { name: "Update PIN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PIN must be 4-6 digits");

    await user.clear(screen.getByLabelText("New PIN"));
    await user.clear(screen.getByLabelText("Confirm new PIN"));
    await user.type(screen.getByLabelText("New PIN"), "5678");
    await user.type(screen.getByLabelText("Confirm new PIN"), "8765");
    await user.click(screen.getByRole("button", { name: "Update PIN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PINs do not match");
  });

  it("filters recent activity by member", async () => {
    vi.mocked(listActivity).mockResolvedValue([
      {
        id: 1,
        at: new Date("2026-10-31T05:00:00Z"),
        actor: "Phani",
        event: "login",
        summary: "Phani signed in",
      },
      {
        id: 2,
        at: new Date("2026-10-31T05:01:00Z"),
        actor: "Ravi",
        event: "sale.create",
        summary: "Sale SD-2026-000010",
      },
    ]);
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("Phani signed in")).toBeInTheDocument();
    expect(screen.getByText("Sale SD-2026-000010")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Member"), "Ravi");
    expect(screen.queryByText("Phani signed in")).not.toBeInTheDocument();
    expect(screen.getByText("Sale SD-2026-000010")).toBeInTheDocument();
  });

  it("owner sees members and can add one", async () => {
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("Ravi")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Member name"), "Priya");
    await user.type(screen.getByLabelText("Member phone"), "9000000000");
    await user.type(screen.getByLabelText("Member password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(createUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Priya", phone: "9000000000", role: "staff" }),
    );
    expect(await screen.findByText("Member added")).toBeInTheDocument();
  });

  it("owner can deactivate a member", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Ravi");
    const [raviDeactivate] = screen.getAllByRole("button", { name: "Deactivate" });
    await user.click(raviDeactivate);

    expect(setUserActive).toHaveBeenCalledWith(expect.anything(), 2, false);
    expect(await screen.findByText(/Ravi disabled/)).toBeInTheDocument();
  });

  it("hides the users card from staff", async () => {
    vi.mocked(getAuditActor).mockReturnValue({ userId: 2, name: "Ravi", role: "staff" });
    vi.mocked(can).mockReturnValue(false);
    renderPage();
    await screen.findByText(/PIN: set/);
    expect(screen.queryByTestId("members-card")).not.toBeInTheDocument();
  });

  it("removes the saved AI key", async () => {
    vi.mocked(getSecret).mockImplementation(async (key) =>
      key === "OLLAMA_API_KEY" ? "secret-key" : "saved",
    );
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText(/AI cloud key: saved/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove key" }));

    expect(deleteSecret).toHaveBeenCalledWith("OLLAMA_API_KEY");
    expect(await screen.findByText(/AI cloud key: not saved/)).toBeInTheDocument();
  });
});
