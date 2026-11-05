import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Purchases from "./Purchases";
import { DbProvider } from "../lib/db-context";
import { listItems } from "../db/items";
import { deletePurchase, listPurchases, updatePurchase } from "../db/purchases";

vi.mock("../db/permissions", () => ({ can: () => true }));

vi.mock("../db/client", () => ({ getDb: vi.fn(() => ({})), pingDb: vi.fn() }));
vi.mock("../db/items", () => ({ listItems: vi.fn() }));
vi.mock("../db/purchases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/purchases")>();
  return { ...actual, listPurchases: vi.fn(), updatePurchase: vi.fn(), deletePurchase: vi.fn() };
});

const ROW = {
  id: 1,
  date: "2026-10-30",
  itemId: 1,
  itemName: "Rice",
  unit: "kg",
  qtyBase: 2000,
  unitPricePaise: 1200,
  totalPaise: 2400,
  paidPaise: 0,
  supplier: "Sri Traders",
  paymentMode: "Cash",
  note: null,
  qtyRemaining: 1500,
};

function renderPage() {
  return render(
    <DbProvider url="postgresql://user:pass@localhost:5432/test">
      <Purchases />
    </DbProvider>,
  );
}

describe("Purchases list", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([
      { id: 1, name: "Rice", unit: "kg", category: null, hsnCode: null, minStockBase: 0, imageUrl: null, stockLeftBase: 1500 },
    ]);
    vi.mocked(listPurchases).mockReset().mockResolvedValue([ROW]);
    vi.mocked(updatePurchase).mockReset().mockResolvedValue(undefined);
    vi.mocked(deletePurchase).mockReset().mockResolvedValue(undefined);
  });

  it("shows date, qty, unit price, total, supplier and batch remaining", async () => {
    renderPage();

    expect(await screen.findByText("Sri Traders")).toBeInTheDocument();
    expect(screen.getByText("2026-10-30")).toBeInTheDocument();
    expect(screen.getByText("2.00 kg")).toBeInTheDocument();
    expect(screen.getByText("₹12.00")).toBeInTheDocument();
    expect(screen.getByText("₹24.00")).toBeInTheDocument();
    expect(screen.getByText("1.50 kg")).toBeInTheDocument();
  });

  it("reloads with the chosen item filter", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole("option", { name: "Rice" });
    await user.selectOptions(screen.getByLabelText("Item"), "1");
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(listPurchases).toHaveBeenLastCalledWith(expect.anything(), {
      itemId: 1,
      from: undefined,
      to: undefined,
    });
  });

  it("opens the edit dialog prefilled and saves the new price", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Sri Traders");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/quantity/i)).toHaveValue(2);
    expect(within(dialog).getByLabelText(/unit price/i)).toHaveValue(12);

    await user.clear(within(dialog).getByLabelText(/unit price/i));
    await user.type(within(dialog).getByLabelText(/unit price/i), "11");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(updatePurchase).toHaveBeenCalledWith(
      "postgresql://user:pass@localhost:5432/test",
      1,
      expect.objectContaining({ qty: 2, unitPricePaise: 1100, date: "2026-10-30" }),
    );
  });

  it("asks before deleting a purchase", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Sri Traders");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete this purchase?");

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deletePurchase).toHaveBeenCalledWith(
      "postgresql://user:pass@localhost:5432/test",
      1,
    );
  });
});
