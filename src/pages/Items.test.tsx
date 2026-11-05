import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Items from "./Items";
import { DbProvider } from "../lib/db-context";
import { createItem, deleteItem, listItems, updateItem } from "../db/items";

vi.mock("../db/permissions", () => ({ can: () => true }));

vi.mock("../db/client", () => ({ getDb: vi.fn(() => ({})), pingDb: vi.fn() }));

vi.mock("../db/items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/items")>();
  return {
    ...actual,
    listItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  };
});

function renderItems() {
  return render(
    <DbProvider url="postgresql://user:pass@localhost:5432/test">
      <Items />
    </DbProvider>,
  );
}

describe("Items page", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([]);
    vi.mocked(createItem).mockReset();
    vi.mocked(updateItem).mockReset();
    vi.mocked(deleteItem).mockReset();
  });

  it("shows 'Name is required' and does not save an empty item", async () => {
    renderItems();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /add item/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Name is required/i);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("saves a valid item with min stock converted to base units", async () => {
    renderItems();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /add item/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Basmati Rice");
    await user.clear(within(dialog).getByLabelText(/min stock/i));
    await user.type(within(dialog).getByLabelText(/min stock/i), "2.5");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    expect(createItem).toHaveBeenCalledWith(expect.anything(), {
      name: "Basmati Rice",
      unit: "kg",
      category: "",
      hsnCode: undefined,
      minStockBase: 2500,
    });
  });

  it("saves the HSN code entered on the item form", async () => {
    renderItems();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /add item/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Basmati Rice");
    await user.type(within(dialog).getByLabelText(/hsn code/i), "090111");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    expect(createItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Basmati Rice", hsnCode: "090111" }),
    );
  });

  it("renders stock using kg formatting", async () => {
    vi.mocked(listItems).mockResolvedValue([
      { id: 1, name: "Rice", unit: "kg", category: "Grains", hsnCode: null, avgCostPaise: 0, minStockBase: 1000, imageUrl: null, stockLeftBase: 1500 },
    ]);
    renderItems();

    expect(await screen.findByText("1.50 kg")).toBeInTheDocument();
  });
});
