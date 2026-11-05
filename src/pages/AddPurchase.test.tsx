import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AddPurchase from "./AddPurchase";
import { DbProvider } from "../lib/db-context";
import { listItems } from "../db/items";
import { addPurchase, getLastPurchase, listSuppliers } from "../db/purchases";

vi.mock("../db/client", () => ({ getDb: vi.fn(() => ({})), pingDb: vi.fn() }));

vi.mock("../db/items", () => ({ listItems: vi.fn() }));

vi.mock("../db/purchases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/purchases")>();
  return {
    ...actual,
    addPurchase: vi.fn(),
    getLastPurchase: vi.fn(),
    listSuppliers: vi.fn(),
  };
});

const RICE = {
  id: 1,
  name: "Rice",
  unit: "kg",
  category: null,
  hsnCode: null,
  minStockBase: 0,
  imageUrl: null,
  stockLeftBase: 0,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DbProvider url="postgresql://user:pass@localhost:5432/test">
        <AddPurchase />
      </DbProvider>
    </MemoryRouter>,
  );
}

async function chooseRice() {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Rice" });
  await user.selectOptions(screen.getByLabelText("Item"), "1");
  return user;
}

describe("AddPurchase", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([RICE]);
    vi.mocked(listSuppliers).mockReset().mockResolvedValue([]);
    vi.mocked(getLastPurchase).mockReset().mockResolvedValue(null);
    vi.mocked(addPurchase).mockReset();
  });

  it("updates the total live: 2 kg x ₹12 = ₹24.00", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity/i), "2");
    await user.type(screen.getByLabelText(/unit price/i), "12");

    expect(screen.getByText("₹24.00")).toBeInTheDocument();
  });

  it("prefills the last price and shows it with its date", async () => {
    vi.mocked(getLastPurchase).mockResolvedValue({ unitPricePaise: 1000, date: "2026-10-01" });
    renderPage();
    await chooseRice();

    expect(screen.getByLabelText(/unit price/i)).toHaveValue(10);
    expect(await screen.findByText("Last price: ₹10.00 (2026-10-01)")).toBeInTheDocument();
  });

  it("shows an error for an empty quantity", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/unit price/i), "12");
    await user.click(screen.getByRole("button", { name: /save purchase/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/quantity must be more than 0/i);
    expect(addPurchase).not.toHaveBeenCalled();
  });

  it("shows an error for a negative quantity", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity/i), "-2");
    await user.type(screen.getByLabelText(/unit price/i), "12");
    await user.click(screen.getByRole("button", { name: /save purchase/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/quantity must be more than 0/i);
    expect(addPurchase).not.toHaveBeenCalled();
  });

  it("shows an error for a negative price", async () => {
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity/i), "2");
    await user.type(screen.getByLabelText(/unit price/i), "-12");
    await user.click(screen.getByRole("button", { name: /save purchase/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/price cannot be negative/i);
    expect(addPurchase).not.toHaveBeenCalled();
  });

  it("saves and reports the price change versus last time", async () => {
    vi.mocked(getLastPurchase).mockResolvedValue({ unitPricePaise: 1000, date: "2026-10-01" });
    vi.mocked(addPurchase).mockResolvedValue({
      purchaseId: 1,
      batchId: 1,
      movementId: 1,
      qtyBase: 2000,
      totalPaise: 2400,
    });
    renderPage();
    const user = await chooseRice();

    await user.type(screen.getByLabelText(/quantity/i), "2");
    await user.clear(screen.getByLabelText(/unit price/i));
    await user.type(screen.getByLabelText(/unit price/i), "12");
    await user.click(screen.getByRole("button", { name: /save purchase/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved ₹24.00 — +20% vs last time");
    expect(addPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: 1, qty: 2, unitPricePaise: 1200, paymentMode: "Cash" }),
    );
  });
});
