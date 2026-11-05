/**
 * Role-based permissions (Owner / CA / Staff) shared by the web UI and the API.
 *
 * Every sidebar module has five permissions: view, create, edit, delete, export.
 * The defaults below are the starting point; the owner can change CA/Staff in
 * Team → Roles & permissions. Owner always has everything and cannot be edited.
 */

export const ROLES = ["owner", "ca", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  "dashboard",
  "billing",
  "bills",
  "items",
  "purchases",
  "stock",
  "customers",
  "expenses",
  "suppliers",
  "investments",
  "reports",
  "activity",
  "team",
  "settings",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionSet = Record<PermissionAction, boolean>;
export type RolePermissions = Record<ModuleKey, PermissionSet>;

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  billing: "New Bill",
  bills: "Invoices",
  items: "Items",
  purchases: "Purchases",
  stock: "Stock Check",
  customers: "Customers",
  expenses: "Expenses",
  suppliers: "Supplier Dues",
  investments: "Investments",
  reports: "Reports",
  activity: "Activity",
  team: "Team",
  settings: "Settings",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
};

const DENY: PermissionSet = { view: false, create: false, edit: false, delete: false, export: false };

function allow(...actions: PermissionAction[]): PermissionSet {
  const set: PermissionSet = { ...DENY };
  for (const action of actions) set[action] = true;
  return set;
}

function build(entries: Partial<Record<ModuleKey, PermissionAction[]>>): RolePermissions {
  const result = {} as RolePermissions;
  for (const moduleKey of MODULES) {
    result[moduleKey] = entries[moduleKey] ? allow(...entries[moduleKey]) : { ...DENY };
  }
  return result;
}

/** Owner: everything, always. */
export function ownerPermissions(): RolePermissions {
  const result = {} as RolePermissions;
  for (const moduleKey of MODULES) result[moduleKey] = allow(...PERMISSION_ACTIONS);
  return result;
}

/** Preloaded defaults for the three roles. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, RolePermissions> = {
  owner: ownerPermissions(),
  ca: build({
    dashboard: ["view", "export"],
    bills: ["view", "export"],
    purchases: ["view", "export"],
    expenses: ["view", "export"],
    suppliers: ["view", "export"],
    investments: ["view", "export"],
    reports: ["view", "export"],
    items: ["view"],
    customers: ["view"],
    stock: ["view"],
  }),
  staff: build({
    billing: ["view", "create"],
    purchases: ["view", "create"],
    expenses: ["view", "create"],
    suppliers: ["view", "create"],
    stock: ["view", "create"],
    customers: ["view", "create"],
    bills: ["view"],
    items: ["view"],
  }),
};

export function isRole(value: unknown): value is Role {
  return value === "owner" || value === "ca" || value === "staff";
}

export function isModule(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULES as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is PermissionAction {
  return typeof value === "string" && (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

/** Does a permission matrix allow `action` on `moduleKey`? */
export function allowed(
  permissions: RolePermissions | null | undefined,
  moduleKey: ModuleKey,
  action: PermissionAction,
): boolean {
  return Boolean(permissions?.[moduleKey]?.[action]);
}
