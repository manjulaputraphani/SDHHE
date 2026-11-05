import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Billing from "./Billing";
import { DbProvider } from "../lib/db-context";
import { listItems } from "../db/items";
import { createCustomer, createSaleBill, findCustomerByGstin, getSaleBill } from "../db/billing";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("../db/permissions", () => ({ can: () => true }));

vi.mock("../db/client", () => ({
  getDb: vi.fn(() => ({})),
  getTxDb: vi.fn(),
  withTransaction: vi.fn(),
  pingDb: vi.fn(),
}));
vi.mock("../db/items", () => ({ listItems: vi.fn() }));
vi.mock("../db/customers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/customers")>();
  return { ...actual, listCustomers: vi.fn(async () => []) };
});
vi.mock("../db/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/billing")>();
  return {
    ...actual,
    createCustomer: vi.fn(),
    createSaleBill: vi.fn(),
    getSaleBill: vi.fn(),
    findCustomerByGstin: vi.fn(),
  };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../db/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/settings")>();
  return {
    ...actual,
    getShopDetails: vi.fn(async () => ({ name: "SDHHE", address: "Main Road", phone: "99999", gstin: "36ABCDE1234F1Z5" })),
  };
});

const RICE = { id: 1, name: "Rice", unit: "kg", category: null, hsnCode: null, avgCostPaise: 0, minStockBase: 0, imageUrl: null, stockLeftBase: 4000 };
const URL = "postgresql://user:pass@localhost:5432/test";

function renderPage() {
  return render(
    <DbProvider url={URL}>
      <Billing />
    </DbProvider>,
  );
}

async function addRiceLine() {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Rice" });
  await user.selectOptions(screen.getByLabelText("Item"), "1");
  await user.type(screen.getByLabelText(/^Qty/), "2");
  await user.type(screen.getByLabelText(/^Rate/), "20");
  await user.click(screen.getByRole("button", { name: "Add" }));
  return user;
}

describe("GST billing", () => {
  beforeEach(() => {
    vi.mocked(listItems).mockReset().mockResolvedValue([RICE]);
    vi.mocked(createCustomer).mockReset();
    vi.mocked(createSaleBill).mockReset();
    vi.mocked(getSaleBill).mockReset();
    vi.mocked(findCustomerByGstin).mockReset().mockResolvedValue(null);
  });

  it("adds a line and applies 5% GST", async () => {
    renderPage();
    await addRiceLine();

    expect(screen.getAllByText("Rice").length).toBeGreaterThan(1); // option + line
    expect(screen.getByText(/Total ₹42\.00/)).toBeInTheDocument();
  });

  it("saves the bill and shows the printable preview", async () => {
    vi.mocked(createSaleBill).mockResolvedValue({
      saleId: 7,
      billNo: "SD-2026-000001",
      subtotalPaise: 4000,
      totalPaise: 4200,
      profitPaise: 1600,
    });
    vi.mocked(getSaleBill).mockResolvedValue({
      id: 7,
      billNo: "SD-2026-000001",
      saleDate: "2026-10-31",
      customerName: null,
      customerPhone: null,
      customerAddress: null,
      customerGstin: null,
      customerEmail: null,
      paymentMode: "Cash",
      subtotalPaise: 4000,
      discountPaise: 0,
      gstPaise: 200,
      gstRateBp: 500,
      totalPaise: 4200,
      paidPaise: 4200,
      cancelled: false,
      lines: [
        {
          itemName: "Rice",
          unit: "kg",
          qtyBase: 2000,
          unitPricePaise: 2000,
          hsnCode: null,
          lineTotalPaise: 4000,
          costPaise: 2400,
          profitPaise: 1600,
        },
      ],
    });

    renderPage();
    const user = await addRiceLine();
    await user.click(screen.getByTestId("billing-save"));

    expect(createSaleBill).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        paymentMode: "Cash",
        gstPaise: 200,
        lines: [{ itemId: 1, qtyBase: 2000, unitPricePaise: 2000 }],
      }),
    );
    expect(await screen.findByTestId("bill-preview")).toBeInTheDocument();
    expect(screen.getByText("Bill SD-2026-000001")).toBeInTheDocument();
    expect(screen.getByTestId("bill-print")).toBeInTheDocument();
  });

  it("refuses a credit bill without a customer", async () => {
    renderPage();
    const user = await addRiceLine();
    await user.selectOptions(screen.getByLabelText("Payment"), "Credit");
    await user.click(screen.getByTestId("billing-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a customer for a credit sale");
    expect(createSaleBill).not.toHaveBeenCalled();
  });

  it("auto-fills a saved customer when the GSTIN is valid", async () => {
    vi.mocked(findCustomerByGstin).mockResolvedValue({
      id: 9,
      name: "KALKI ENTERPRISES",
      phone: "9000000001",
      address: "1-16-135, REVENUE COLONY, Kurnool",
      gstin: "27AAPFU0939F1ZV",
      email: "buyer@example.com",
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Customer GSTIN"), "27AAPFU0939F1ZV");

    expect(await screen.findByText(/Loaded saved customer details/)).toBeInTheDocument();
    expect(screen.getByLabelText("Customer (optional)")).toHaveValue("KALKI ENTERPRISES");
    expect(screen.getByLabelText("Billing address")).toHaveValue("1-16-135, REVENUE COLONY, Kurnool");
    expect(findCustomerByGstin).toHaveBeenCalledWith(expect.anything(), "27AAPFU0939F1ZV");
  });

  it("warns on a wrong GSTIN check digit", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Customer GSTIN"), "27AAPFU0939F1ZW");

    expect(await screen.findByText(/Check digit should be V/)).toBeInTheDocument();
    expect(findCustomerByGstin).not.toHaveBeenCalled();
  });

  it("opens the GST portal for a captcha lookup", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("gst-portal");

    await user.click(screen.getByTestId("gst-portal"));
    expect(openUrl).toHaveBeenCalledWith("https://services.gst.gov.in/services/searchtp");
  });
});
