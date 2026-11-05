import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StockCheck from "./StockCheck";
import { DbProvider } from "../lib/db-context";
import { listItems } from "../db/items";
import { listOpenBatches, saveStockEntry } from "../db/stock";

vi.mock("../db/permissions", () => ({ can: () => true }));

vi.mock("../db/client", () => ({
  getDb: vi.fn(() => ({})),
  getTxDb: vi.fn(),
  withTransaction: vi.fn(),
  pingDb: vi.fn(),
}));
vi.mock("../db/items", () => ({ listItems: vi.fn() }));
vi.mock("../db/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/stock")>();
  return { ...actual, listOpenBatches: vi.fn(), saveStockEntry: vi.fn() };
});

const RICE = { id: 1, name: "Rice", unit: "kg", category: null, hsnCode: null, avgCostPaise: 0, minStockBase: 0, imageUrl: null, stockLeftBase: 4000 };

function renderPage() {
  return render(
    <DbProvider url="postgresql://user:pass@localhost:5432/test">
      <StockCheck />
    </DbProvider>,
  );
}

async function chooseRice() {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Rice" });
  await user.selectOptions(screen.getByLabelText("Item"), "1");
  return user;
}

describe("StockCheck screen", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([RICE]);
    vi.mocked(listOpenBatches).mockReset().mockResolvedValue([
      { id: 1, qtyRemaining: 1000, unitPricePaise: 1000, purchaseDate: "2026-10-01" },
      { id: 2, qtyRemaining: 3000, unitPricePaise: 1200, purchaseDate: "2026-10-02" },
    ]);
    vi.mocked(saveStockEntry).mockReset();
  });

  it("shows the preview before confirming", async () => {
    renderPage();
    const user = await chooseRice();

    expect(await screen.findByText(/Current stock: 4\.00 kg/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/stock left/i), "2");

    expect(await screen.findByText(/Used 2\.00 kg · Cost ₹22\.00/)).toBeInTheDocument();
    expect(
      screen.getByText(/From: 1\.00 kg @ ₹10\.00 \+ 1\.00 kg @ ₹12\.00/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Left 2\.00 kg worth ₹24\.00/)).toBeInTheDocument();
  });

  it("shows a friendly error when stock left exceeds current stock", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/stock left/i), "5");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stock left is more than current stock (4000). Did you miss a purchase?",
    );
  });

  it("saves the entry on confirm", async () => {
    vi.mocked(saveStockEntry).mockResolvedValue({ movementId: 9, used: 2000, costPaise: 2200 });
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/stock left/i), "2");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(saveStockEntry).toHaveBeenCalledWith(
      "postgresql://user:pass@localhost:5432/test",
      expect.objectContaining({ itemId: 1, type: "STOCK_CHECK", enteredLeft: 2000 }),
    );
    expect(await screen.findByText(/Saved — used 2\.00 kg, cost ₹22\.00/)).toBeInTheDocument();
  });

  it("switches to Used and takes a quantity directly", async () => {
    renderPage();
    const user = await chooseRice();

    await user.click(screen.getByRole("button", { name: "Used" }));
    await user.type(screen.getByLabelText(/quantity used/i), "1.5");

    expect(await screen.findByText(/Used 1\.50 kg · Cost ₹16\.00/)).toBeInTheDocument();
  });

  it("saves wastage with type WASTAGE and the given quantity", async () => {
    vi.mocked(saveStockEntry).mockResolvedValue({ movementId: 11, used: 300, costPaise: 300 });
    renderPage();
    const user = await chooseRice();

    await user.click(screen.getByRole("button", { name: "Wastage" }));
    await user.type(screen.getByLabelText(/quantity wasted/i), "0.3");
    expect(await screen.findByText(/Used 0\.30 kg · Cost ₹3\.00/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(saveStockEntry).toHaveBeenCalledWith(
      "postgresql://user:pass@localhost:5432/test",
      expect.objectContaining({ itemId: 1, type: "WASTAGE", qty: 300, enteredLeft: null }),
    );
  });
});
