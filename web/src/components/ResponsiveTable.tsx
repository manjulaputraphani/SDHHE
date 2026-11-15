import type { ReactNode } from "react";

export type ResponsiveTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Label shown in a stacked mobile card (defaults to a string header). */
  mobileLabel?: string;
  /** Skip this column in the stacked mobile card (e.g. actions). */
  hideOnMobile?: boolean;
  className?: string;
};

export type ResponsiveTableProps<T> = {
  columns: ResponsiveTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  title?: ReactNode;
  headerRight?: ReactNode;
  empty?: ReactNode;
  /** Extra min-width for the desktop table. */
  minWidthClass?: string;
  /** colgroup widths, same order as `columns` (literal Tailwind classes). */
  widths?: string[];
  className?: string;
};

/**
 * A table that turns into stacked cards below 640px.
 * Shared by Expenses, Purchases and Stock Check.
 */
export default function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  title,
  headerRight,
  empty,
  minWidthClass = "",
  widths,
  className = "",
}: ResponsiveTableProps<T>) {
  return (
    <div className={`card ${className}`}>
      {(title || headerRight) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          {typeof title === "string" ? <h2 className="text-sm font-medium">{title}</h2> : title}
          {headerRight}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          {empty ?? <p className="text-sm text-muted">Nothing here yet.</p>}
        </div>
      ) : (
        <>
          {/* Desktop / tablet: a real table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className={`w-full ${minWidthClass} text-left text-sm`}>
              {widths && widths.length > 0 && (
                <colgroup>
                  {widths.map((width, index) => (
                    <col key={index} className={width} />
                  ))}
                </colgroup>
              )}
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-2 align-middle ${column.align === "right" ? "text-right" : ""}`}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-line">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-2 align-middle ${column.align === "right" ? "text-right" : ""} ${
                          column.className ?? ""
                        }`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="space-y-2 p-3 sm:hidden">
            {rows.map((row) => (
              <div key={rowKey(row)} className="rounded-lg border border-line p-3">
                {columns
                  .filter((column) => !column.hideOnMobile)
                  .map((column) => (
                    <div
                      key={column.key}
                      className={`flex items-center justify-between gap-3 py-0.5 ${
                        column.align === "right" ? "text-right" : ""
                      }`}
                    >
                      <span className="shrink-0 text-xs text-muted">
                        {column.mobileLabel ??
                          (typeof column.header === "string" ? column.header : column.key)}
                      </span>
                      <span className="min-w-0 text-sm">{column.cell(row)}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
