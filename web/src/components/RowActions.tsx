import type { MouseEventHandler, ReactNode } from "react";
import { IconPencil, IconTrash2 } from "./icons";

/**
 * Icon-only Edit / Delete buttons for table rows.
 * Square 36px hit area, one row, 8px gap — shared by every list so they match.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">{children}</span>;
}

function RowActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`row-action${danger ? " row-action-danger" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function EditRowButton({
  label = "Edit",
  onClick,
}: {
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <RowActionButton label={label} onClick={onClick}>
      <IconPencil />
    </RowActionButton>
  );
}

export function DeleteRowButton({
  label = "Delete",
  onClick,
}: {
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <RowActionButton label={label} danger onClick={onClick}>
      <IconTrash2 />
    </RowActionButton>
  );
}
