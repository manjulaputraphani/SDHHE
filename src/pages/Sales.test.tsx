import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sales from "./Sales";
import { DbProvider } from "../lib/db-context";
import { listItems } from "../db/items";
import { listOpenBatches } from "../db/stock";
import { listSales, saveSale } from "../db/sales";

vi.mock("../db/client", () => ({
  getDb: vi.fn(() => ({})),
  getTxDb: vi.fn(),
  withTransaction: vi.fn(),
  pingDb: vi.fn(),
}));
vi.mock("../db/items", () => ({ listItems: vi.fn() }));
vi.mock("../db/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/stock")>();
  return { ...actual, listOpenBatches: vi.fn() };
});
vi.mock("../db/sales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/sales")>();
  return { ...actual, listSales: vi.fn(), saveSale: vi.fn() };
});

const RICE = { id: 1, name: "Rice", unit: "kg", category: null, hsnCode: null, avgCostPaise: 0, minStockBase: 0, imageUrl: null, stockLeftBase: 4000 };
const URL = "postgresql://user:pass@localhost:5432/test";

function renderPage() {
  return render(
    <DbProvider url={URL}>
      <Sales />
    </DbProvider>,
  );
}

async function chooseRice() {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Rice" });
  await user.selectOptions(screen.getByLabelText("Item"), "1");
  return user;
}

describe("Sales screen", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([RICE]);
    vi.mocked(listOpenBatches).mockReset().mockResolvedValue([
      { id: 1, qtyRemaining: 1000, unitPricePaise: 1000, purchaseDate: "2026-10-01" },
      { id: 2, qtyRemaining: 3000, unitPricePaise: 1200, purchaseDate: "2026-10-02" },
    ]);
    vi.mocked(listSales).mockReset().mockResolvedValue([]);
    vi.mocked(saveSale).mockReset();
  });

  it("shows revenue and remaining stock before saving", async () => {
    renderPage();
    const user = await chooseRice();

    expect(await screen.findByText(/Current stock: 4\.00 kg/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/quantity sold/i), "2");
    await user.type(screen.getByLabelText(/sale price/i), "20");

    expect(await screen.findByText(/Revenue ₹40\.00 · Left 2\.00 kg/)).toBeInTheDocument();
  });

  it("refuses to sell more than the stock left", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity sold/i), "5");
    await user.type(screen.getByLabelText(/sale price/i), "20");

    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough stock");
  });

  it("saves the sale with base units and paise", async () => {
    vi.mocked(saveSale).mockResolvedValue({
      saleId: 1,
      movementId: 9,
      qtyBase: 2000,
      revenuePaise: 4000,
      costPaise: 2200,
      leftQty: 2000,
    });
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity sold/i), "2");
    await user.type(screen.getByLabelText(/sale price/i), "20");
    await user.click(screen.getByRole("button", { name: "Save sale" }));

    expect(saveSale).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ itemId: 1, qty: 2000, unitPricePaise: 2000 }),
    );
    expect(
      await screen.findByText(/Saved — sold 2\.00 kg for ₹40\.00 · stock left 2\.00 kg/),
    ).toBeInTheDocument();
  });

  it("lists saved sales", async () => {
    vi.mocked(listSales).mockResolvedValue([
      {
        id: 4,
        itemId: 1,
        itemName: "Rice",
        unit: "kg",
        qtyBase: 2000,
        unitPricePaise: 2000,
        totalPaise: 4000,
        soldAt: "2026-10-30",
        note: "shop",
      },
    ]);
    renderPage();

    expect(await screen.findByText("2026-10-30")).toBeInTheDocument();
    expect(screen.getByText("₹20.00 / kg")).toBeInTheDocument();
    expect(screen.getByText("₹40.00")).toBeInTheDocument();
    expect(screen.getByText("shop")).toBeInTheDocument();
  });
});
