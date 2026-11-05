import { z } from "zod";
import type { Db } from "../db/client";
import { sql } from "drizzle-orm";

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

/** READ-ONLY tool implementations. There is deliberately no write tool. */
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_item_usage",
      description: "How much of an item was used between two dates (in base units).",
      parameters: {
        type: "object",
        properties: {
          itemName: { type: "string" },
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["itemName", "fromDate", "toDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_price_history",
      description: "Purchase prices of an item, newest first.",
      parameters: {
        type: "object",
        properties: { itemName: { type: "string" } },
        required: ["itemName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock_items",
      description: "Items at or below their minimum stock.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spending_by_category",
      description: "Expenses grouped by category for a month (YYYY-MM).",
      parameters: {
        type: "object",
        properties: { month: { type: "string" } },
        required: ["month"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_supplier_comparison",
      description: "Average purchase price per supplier for an item.",
      parameters: {
        type: "object",
        properties: { itemName: { type: "string" } },
        required: ["itemName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stock_value",
      description: "Total value of stock on hand, in rupees.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export const TOOL_NAMES = TOOLS.map((tool) => tool.function.name);

const nameArg = z.object({ itemName: z.string().min(1) });
const rangeArg = z.object({
  itemName: z.string().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const monthArg = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

/** Run one read-only tool. Unknown names are refused. */
export async function runTool(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_item_usage": {
      const { itemName, fromDate, toDate } = rangeArg.parse(args);
      return rowsOf(
        await db.execute(sql`
          select i.name as item, i.unit,
                 coalesce(sum(case when m.type in ('STOCK_CHECK','USAGE') then -m.qty_change else 0 end), 0)::int as used_base,
                 coalesce(sum(case when m.type = 'WASTAGE' then -m.qty_change else 0 end), 0)::int as wasted_base
          from items i
          left join stock_movements m on m.item_id = i.id
            and m.movement_date >= ${fromDate}::date and m.movement_date <= ${toDate}::date
          where lower(i.name) = lower(${itemName})
          group by i.id, i.name, i.unit
        `),
      );
    }
    case "get_price_history": {
      const { itemName } = nameArg.parse(args);
      return rowsOf(
        await db.execute(sql`
          select p.purchase_date::text as date, p.unit_price_paise::int as price_paise,
                 s.name as supplier
          from purchases p
          join items i on i.id = p.item_id
          left join suppliers s on s.id = p.supplier_id
          where lower(i.name) = lower(${itemName}) and p.source = 'purchase'
          order by p.purchase_date desc, p.id desc
          limit 20
        `),
      );
    }
    case "get_low_stock_items":
      return rowsOf(
        await db.execute(sql`
          select i.name, i.unit, i.min_stock_base::int as min_stock_base,
                 coalesce(sum(b.qty_remaining), 0)::int as stock_base
          from items i
          left join batches b on b.item_id = i.id
          group by i.id, i.name, i.unit, i.min_stock_base
          having coalesce(sum(b.qty_remaining), 0) <= i.min_stock_base
          order by i.name
        `),
      );
    case "get_spending_by_category": {
      const { month } = monthArg.parse(args);
      return rowsOf(
        await db.execute(sql`
          select category, sum(amount_paise)::int as total_paise
          from expenses
          where to_char(expense_date, 'YYYY-MM') = ${month}
          group by category
          order by total_paise desc
        `),
      );
    }
    case "get_supplier_comparison": {
      const { itemName } = nameArg.parse(args);
      return rowsOf(
        await db.execute(sql`
          select coalesce(s.name, '(none)') as supplier,
                 round(avg(p.unit_price_paise))::int as avg_price_paise,
                 count(*)::int as purchases
          from purchases p
          join items i on i.id = p.item_id
          left join suppliers s on s.id = p.supplier_id
          where lower(i.name) = lower(${itemName}) and p.source = 'purchase'
          group by s.name
          order by avg_price_paise
        `),
      );
    }
    case "get_stock_value":
      return rowsOf(
        await db.execute(sql`
          select coalesce(round(sum(b.qty_remaining * b.unit_price_paise::numeric /
                 case when i.unit = '60 kg bag' then 60000 when i.unit in ('kg','l') then 1000 else 1 end)), 0)::int as value_paise
          from batches b join items i on i.id = b.item_id
        `),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
