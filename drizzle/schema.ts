import { pgTable, index, uniqueIndex, uuid, text, boolean, timestamp, varchar, integer, foreignKey, serial, date, check, unique, numeric, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const users = pgTable("Users", {
	id: uuid("Id").primaryKey().notNull(),
	firstName: text("FirstName").notNull(),
	lastName: text("LastName").notNull(),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	userName: varchar("UserName", { length: 256 }),
	normalizedUserName: varchar("NormalizedUserName", { length: 256 }),
	email: varchar("Email", { length: 256 }),
	normalizedEmail: varchar("NormalizedEmail", { length: 256 }),
	emailConfirmed: boolean("EmailConfirmed").notNull(),
	passwordHash: text("PasswordHash"),
	securityStamp: text("SecurityStamp"),
	concurrencyStamp: text("ConcurrencyStamp"),
	phoneNumber: text("PhoneNumber"),
	phoneNumberConfirmed: boolean("PhoneNumberConfirmed").notNull(),
	twoFactorEnabled: boolean("TwoFactorEnabled").notNull(),
	lockoutEnd: timestamp("LockoutEnd", { withTimezone: true, mode: 'string' }),
	lockoutEnabled: boolean("LockoutEnabled").notNull(),
	accessFailedCount: integer("AccessFailedCount").notNull(),
}, (table) => [
	index("EmailIndex").using("btree", table.normalizedEmail.asc().nullsLast().op("text_ops")),
	uniqueIndex("UserNameIndex").using("btree", table.normalizedUserName.asc().nullsLast().op("text_ops")),
]);

export const userClaims = pgTable("UserClaims", {
	id: integer("Id").primaryKey().generatedByDefaultAsIdentity({ name: 'UserClaims_Id_seq', startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647 }),
	userId: uuid("UserId").notNull(),
	claimType: text("ClaimType"),
	claimValue: text("ClaimValue"),
}, (table) => [
	index("IX_UserClaims_UserId").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_UserClaims_Users_UserId"
		}).onDelete("cascade"),
]);

export const expenses = pgTable("expenses", {
	id: serial().primaryKey().notNull(),
	category: text().notNull(),
	amountPaise: integer("amount_paise").notNull(),
	expenseDate: date("expense_date").notNull(),
	paymentMode: text("payment_mode"),
	note: text(),
	paidTo: text("paid_to"),
});

export const settings = pgTable("settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
});


export const stockMovements = pgTable("stock_movements", {
	id: serial().primaryKey().notNull(),
	itemId: integer("item_id").notNull(),
	type: text().notNull(),
	qtyChange: integer("qty_change").notNull(),
	costPaise: integer("cost_paise").notNull(),
	enteredQtyLeft: integer("entered_qty_left"),
	movementDate: date("movement_date").notNull(),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.id],
			name: "stock_movements_item_id_items_id_fk"
		}),
	check("stock_movements_type_valid", sql`type = ANY (ARRAY['PURCHASE'::text, 'STOCK_CHECK'::text, 'USAGE'::text, 'WASTAGE'::text, 'ADJUSTMENT'::text, 'SALE'::text])`),
]);

export const items = pgTable("items", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	unit: text().notNull(),
	category: text(),
	minStockBase: integer("min_stock_base").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("items_name_unique").on(table.name),
]);

export const aiSuggestions = pgTable("ai_suggestions", {
	id: serial().primaryKey().notNull(),
	type: text().notNull(),
	itemId: integer("item_id"),
	message: text().notNull(),
	priority: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dismissed: boolean().default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.id],
			name: "ai_suggestions_item_id_items_id_fk"
		}),
]);

export const purchases = pgTable("purchases", {
	id: serial().primaryKey().notNull(),
	itemId: integer("item_id").notNull(),
	supplierId: integer("supplier_id"),
	qtyBase: integer("qty_base").notNull(),
	unitPricePaise: integer("unit_price_paise").notNull(),
	totalPaise: integer("total_paise").notNull(),
	purchaseDate: date("purchase_date").notNull(),
	paymentMode: text("payment_mode"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.id],
			name: "purchases_item_id_items_id_fk"
		}),
	foreignKey({
			columns: [table.supplierId],
			foreignColumns: [suppliers.id],
			name: "purchases_supplier_id_suppliers_id_fk"
		}),
	check("purchases_qty_base_positive", sql`qty_base > 0`),
	check("purchases_unit_price_non_negative", sql`unit_price_paise >= 0`),
]);

export const batches = pgTable("batches", {
	id: serial().primaryKey().notNull(),
	purchaseId: integer("purchase_id").notNull(),
	itemId: integer("item_id").notNull(),
	qtyOriginal: integer("qty_original").notNull(),
	qtyRemaining: integer("qty_remaining").notNull(),
	unitPricePaise: integer("unit_price_paise").notNull(),
	purchaseDate: date("purchase_date").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.purchaseId],
			foreignColumns: [purchases.id],
			name: "batches_purchase_id_purchases_id_fk"
		}),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.id],
			name: "batches_item_id_items_id_fk"
		}),
	unique("batches_purchase_id_unique").on(table.purchaseId),
	check("batches_qty_remaining_non_negative", sql`qty_remaining >= 0`),
]);

export const suppliers = pgTable("suppliers", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	phone: text(),
});

export const efMigrationsHistory = pgTable("__EFMigrationsHistory", {
	migrationId: varchar("MigrationId", { length: 150 }).primaryKey().notNull(),
	productVersion: varchar("ProductVersion", { length: 32 }).notNull(),
});

export const sales = pgTable("sales", {
	id: serial().primaryKey().notNull(),
	itemId: integer("item_id").notNull(),
	movementId: integer("movement_id").notNull(),
	qtyBase: integer("qty_base").notNull(),
	unitPricePaise: integer("unit_price_paise").notNull(),
	totalPaise: integer("total_paise").notNull(),
	soldAt: date("sold_at").notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.id],
			name: "sales_item_id_fkey"
		}),
	foreignKey({
			columns: [table.movementId],
			foreignColumns: [stockMovements.id],
			name: "sales_movement_id_fkey"
		}),
	check("sales_qty_positive", sql`qty_base > 0`),
]);

export const roles = pgTable("Roles", {
	id: uuid("Id").primaryKey().notNull(),
	name: varchar("Name", { length: 256 }),
	normalizedName: varchar("NormalizedName", { length: 256 }),
	concurrencyStamp: text("ConcurrencyStamp"),
}, (table) => [
	uniqueIndex("RoleNameIndex").using("btree", table.normalizedName.asc().nullsLast().op("text_ops")),
]);

export const roleClaims = pgTable("RoleClaims", {
	id: integer("Id").primaryKey().generatedByDefaultAsIdentity({ name: 'RoleClaims_Id_seq', startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647 }),
	roleId: uuid("RoleId").notNull(),
	claimType: text("ClaimType"),
	claimValue: text("ClaimValue"),
}, (table) => [
	index("IX_RoleClaims_RoleId").using("btree", table.roleId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "FK_RoleClaims_Roles_RoleId"
		}).onDelete("cascade"),
]);

export const activityLog = pgTable("activity_log", {
	id: serial().primaryKey().notNull(),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	actor: text().default('local').notNull(),
	event: text().notNull(),
	summary: text().notNull(),
	entity: text(),
	entityId: integer("entity_id"),
}, (table) => [
	index("activity_log_at_idx").using("btree", table.at.desc().nullsFirst().op("timestamptz_ops")),
]);

export const auditLogs = pgTable("AuditLogs", {
	id: uuid("Id").primaryKey().notNull(),
	userId: uuid("UserId"),
	action: text("Action").notNull(),
	entityType: text("EntityType").notNull(),
	entityId: uuid("EntityId"),
	oldValues: text("OldValues"),
	newValues: text("NewValues"),
	ipAddress: text("IpAddress"),
	timestamp: timestamp("Timestamp", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_AuditLogs_Timestamp").using("btree", table.timestamp.asc().nullsLast().op("timestamptz_ops")),
]);

export const expenseBills = pgTable("expense_bills", {
	id: serial().primaryKey().notNull(),
	expenseId: integer("expense_id").notNull(),
	filename: text().notNull(),
	mime: text().notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	dataBase64: text("data_base64").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("expense_bills_expense_idx").using("btree", table.expenseId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.expenseId],
			foreignColumns: [expenses.id],
			name: "expense_bills_expense_id_fkey"
		}).onDelete("cascade"),
]);

export const passwordResetTokens = pgTable("PasswordResetTokens", {
	id: uuid("Id").primaryKey().notNull(),
	userId: uuid("UserId").notNull(),
	token: text("Token").notNull(),
	expiresAt: timestamp("ExpiresAt", { withTimezone: true, mode: 'string' }).notNull(),
	isUsed: boolean("IsUsed").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
});

export const products = pgTable("Products", {
	id: uuid("Id").primaryKey().notNull(),
	name: varchar("Name", { length: 200 }).notNull(),
	description: varchar("Description", { length: 1000 }),
	sku: varchar("Sku", { length: 50 }).notNull(),
	unitPrice: numeric("UnitPrice", { precision: 18, scale:  2 }).notNull(),
	stockQuantity: integer("StockQuantity").notNull(),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
	categoryId: uuid("CategoryId"),
	hsnCode: varchar("HsnCode", { length: 20 }).default('').notNull(),
	stockItemId: uuid("StockItemId"),
	taxRate: numeric("TaxRate", { precision: 5, scale:  2 }).default('0.0').notNull(),
}, (table) => [
	index("IX_Products_CategoryId").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("IX_Products_Sku").using("btree", table.sku.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
	index("IX_Products_StockItemId").using("btree", table.stockItemId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [productCategories.id],
			name: "FK_Products_ProductCategories_CategoryId"
		}),
	foreignKey({
			columns: [table.stockItemId],
			foreignColumns: [stockItems.id],
			name: "FK_Products_StockItems_StockItemId"
		}),
]);

export const productPrices = pgTable("ProductPrices", {
	id: uuid("Id").primaryKey().notNull(),
	productId: uuid("ProductId").notNull(),
	price: numeric("Price", { precision: 18, scale:  2 }).notNull(),
	effectiveFrom: timestamp("EffectiveFrom", { withTimezone: true, mode: 'string' }).notNull(),
	effectiveTo: timestamp("EffectiveTo", { withTimezone: true, mode: 'string' }),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_ProductPrices_ProductId").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_ProductPrices_Products_ProductId"
		}).onDelete("cascade"),
]);

export const refreshTokens = pgTable("RefreshTokens", {
	id: uuid("Id").primaryKey().notNull(),
	userId: uuid("UserId").notNull(),
	token: text("Token").notNull(),
	expiresAt: timestamp("ExpiresAt", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("RevokedAt", { withTimezone: true, mode: 'string' }),
	replacedByToken: text("ReplacedByToken"),
	createdByIp: text("CreatedByIp"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	uniqueIndex("IX_RefreshTokens_Token").using("btree", table.token.asc().nullsLast().op("text_ops")),
	index("IX_RefreshTokens_UserId").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
]);

export const blendFormulas = pgTable("BlendFormulas", {
	id: uuid("Id").primaryKey().notNull(),
	name: text("Name").notNull(),
	description: text("Description"),
	costPerKg: numeric("CostPerKg").notNull(),
	sellingPrice: numeric("SellingPrice").notNull(),
	marginPercentage: numeric("MarginPercentage").notNull(),
	productionCost: numeric("ProductionCost").notNull(),
	isTemplate: boolean("IsTemplate").notNull(),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
});

export const blendFormulaItems = pgTable("BlendFormulaItems", {
	id: uuid("Id").primaryKey().notNull(),
	blendFormulaId: uuid("BlendFormulaId").notNull(),
	beanType: integer("BeanType").notNull(),
	percentage: numeric("Percentage").notNull(),
	costPerKg: numeric("CostPerKg").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_BlendFormulaItems_BlendFormulaId").using("btree", table.blendFormulaId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.blendFormulaId],
			foreignColumns: [blendFormulas.id],
			name: "FK_BlendFormulaItems_BlendFormulas_BlendFormulaId"
		}).onDelete("cascade"),
]);

export const customers = pgTable("Customers", {
	id: uuid("Id").primaryKey().notNull(),
	customerCode: text("CustomerCode").notNull(),
	customerName: varchar("CustomerName", { length: 200 }).notNull(),
	ownerName: text("OwnerName"),
	mobile: varchar("Mobile", { length: 20 }).notNull(),
	alternateMobile: text("AlternateMobile"),
	email: text("Email"),
	gstNumber: text("GstNumber"),
	address: text("Address"),
	city: text("City"),
	state: text("State"),
	pincode: text("Pincode"),
	assignedEmployeeId: uuid("AssignedEmployeeId"),
	status: integer("Status").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_Customers_CustomerCode").using("btree", table.customerCode.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const customerFollowUps = pgTable("CustomerFollowUps", {
	id: uuid("Id").primaryKey().notNull(),
	customerId: uuid("CustomerId").notNull(),
	scheduledAt: timestamp("ScheduledAt", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("CompletedAt", { withTimezone: true, mode: 'string' }),
	subject: text("Subject").notNull(),
	notes: text("Notes"),
	isCompleted: boolean("IsCompleted").notNull(),
	assignedEmployeeId: uuid("AssignedEmployeeId"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_CustomerFollowUps_CustomerId").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "FK_CustomerFollowUps_Customers_CustomerId"
		}).onDelete("cascade"),
]);

export const customerNotes = pgTable("CustomerNotes", {
	id: uuid("Id").primaryKey().notNull(),
	customerId: uuid("CustomerId").notNull(),
	note: text("Note").notNull(),
	callSummary: text("CallSummary"),
	isCallNote: boolean("IsCallNote").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_CustomerNotes_CustomerId").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "FK_CustomerNotes_Customers_CustomerId"
		}).onDelete("cascade"),
]);

export const orders = pgTable("Orders", {
	id: uuid("Id").primaryKey().notNull(),
	orderNumber: text("OrderNumber").notNull(),
	customerId: uuid("CustomerId").notNull(),
	status: integer("Status").notNull(),
	orderDate: timestamp("OrderDate", { withTimezone: true, mode: 'string' }).notNull(),
	deliveryDate: timestamp("DeliveryDate", { withTimezone: true, mode: 'string' }),
	subTotal: numeric("SubTotal", { precision: 18, scale:  2 }).notNull(),
	taxAmount: numeric("TaxAmount").notNull(),
	discountAmount: numeric("DiscountAmount").notNull(),
	totalAmount: numeric("TotalAmount", { precision: 18, scale:  2 }).notNull(),
	notes: text("Notes"),
	assignedEmployeeId: uuid("AssignedEmployeeId"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_Orders_CustomerId").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("IX_Orders_OrderNumber").using("btree", table.orderNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "FK_Orders_Customers_CustomerId"
		}).onDelete("cascade"),
]);

export const productionBatches = pgTable("ProductionBatches", {
	id: uuid("Id").primaryKey().notNull(),
	batchNumber: text("BatchNumber").notNull(),
	currentStage: integer("CurrentStage").notNull(),
	blendFormulaId: uuid("BlendFormulaId"),
	roastBatchId: uuid("RoastBatchId"),
	inputQuantity: numeric("InputQuantity").notNull(),
	outputQuantity: numeric("OutputQuantity").notNull(),
	totalCost: numeric("TotalCost").notNull(),
	startedAt: timestamp("StartedAt", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("CompletedAt", { withTimezone: true, mode: 'string' }),
	notes: text("Notes"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_ProductionBatches_BatchNumber").using("btree", table.batchNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
	index("IX_ProductionBatches_BlendFormulaId").using("btree", table.blendFormulaId.asc().nullsLast().op("uuid_ops")),
	index("IX_ProductionBatches_RoastBatchId").using("btree", table.roastBatchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.blendFormulaId],
			foreignColumns: [blendFormulas.id],
			name: "FK_ProductionBatches_BlendFormulas_BlendFormulaId"
		}),
	foreignKey({
			columns: [table.roastBatchId],
			foreignColumns: [roastBatches.id],
			name: "FK_ProductionBatches_RoastBatches_RoastBatchId"
		}),
]);

export const roastBatches = pgTable("RoastBatches", {
	id: uuid("Id").primaryKey().notNull(),
	batchNumber: text("BatchNumber").notNull(),
	beanType: integer("BeanType").notNull(),
	greenWeight: numeric("GreenWeight", { precision: 18, scale:  3 }).notNull(),
	roastProfile: integer("RoastProfile").notNull(),
	yieldPercentage: numeric("YieldPercentage").notNull(),
	roastedWeight: numeric("RoastedWeight").notNull(),
	roastingLoss: numeric("RoastingLoss").notNull(),
	costPerKg: numeric("CostPerKg").notNull(),
	totalCost: numeric("TotalCost").notNull(),
	roastedAt: timestamp("RoastedAt", { withTimezone: true, mode: 'string' }).notNull(),
	notes: text("Notes"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_RoastBatches_BatchNumber").using("btree", table.batchNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const purchaseOrders = pgTable("PurchaseOrders", {
	id: uuid("Id").primaryKey().notNull(),
	poNumber: text("PoNumber").notNull(),
	vendorName: text("VendorName").notNull(),
	status: integer("Status").notNull(),
	orderDate: timestamp("OrderDate", { withTimezone: true, mode: 'string' }).notNull(),
	receivedDate: timestamp("ReceivedDate", { withTimezone: true, mode: 'string' }),
	totalAmount: numeric("TotalAmount").notNull(),
	notes: text("Notes"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_PurchaseOrders_PoNumber").using("btree", table.poNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const purchaseOrderItems = pgTable("PurchaseOrderItems", {
	id: uuid("Id").primaryKey().notNull(),
	purchaseOrderId: uuid("PurchaseOrderId").notNull(),
	stockItemId: uuid("StockItemId").notNull(),
	quantity: numeric("Quantity").notNull(),
	unitCost: numeric("UnitCost").notNull(),
	lineTotal: numeric("LineTotal").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_PurchaseOrderItems_PurchaseOrderId").using("btree", table.purchaseOrderId.asc().nullsLast().op("uuid_ops")),
	index("IX_PurchaseOrderItems_StockItemId").using("btree", table.stockItemId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.purchaseOrderId],
			foreignColumns: [purchaseOrders.id],
			name: "FK_PurchaseOrderItems_PurchaseOrders_PurchaseOrderId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.stockItemId],
			foreignColumns: [stockItems.id],
			name: "FK_PurchaseOrderItems_StockItems_StockItemId"
		}).onDelete("cascade"),
]);

export const stockItems = pgTable("StockItems", {
	id: uuid("Id").primaryKey().notNull(),
	code: text("Code").notNull(),
	name: text("Name").notNull(),
	itemType: integer("ItemType").notNull(),
	unit: text("Unit").notNull(),
	currentQuantity: numeric("CurrentQuantity", { precision: 18, scale:  3 }).notNull(),
	averageCost: numeric("AverageCost", { precision: 18, scale:  4 }).notNull(),
	reorderLevel: numeric("ReorderLevel").notNull(),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_StockItems_Code").using("btree", table.code.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const stockLedger = pgTable("StockLedger", {
	id: uuid("Id").primaryKey().notNull(),
	stockItemId: uuid("StockItemId").notNull(),
	movementType: integer("MovementType").notNull(),
	quantity: numeric("Quantity", { precision: 18, scale:  3 }).notNull(),
	unitCost: numeric("UnitCost").notNull(),
	totalCost: numeric("TotalCost").notNull(),
	balanceAfter: numeric("BalanceAfter").notNull(),
	referenceType: text("ReferenceType"),
	referenceId: uuid("ReferenceId"),
	notes: text("Notes"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_StockLedger_StockItemId").using("btree", table.stockItemId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.stockItemId],
			foreignColumns: [stockItems.id],
			name: "FK_StockLedger_StockItems_StockItemId"
		}).onDelete("cascade"),
]);

export const ledgers = pgTable("Ledgers", {
	id: uuid("Id").primaryKey().notNull(),
	code: text("Code").notNull(),
	name: text("Name").notNull(),
	group: integer("Group").notNull(),
	openingBalance: numeric("OpeningBalance").notNull(),
	currentBalance: numeric("CurrentBalance").notNull(),
	isActive: boolean("IsActive").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_Ledgers_Code").using("btree", table.code.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const voucherDetails = pgTable("VoucherDetails", {
	id: uuid("Id").primaryKey().notNull(),
	voucherHeaderId: uuid("VoucherHeaderId").notNull(),
	ledgerId: uuid("LedgerId").notNull(),
	debitAmount: numeric("DebitAmount").notNull(),
	creditAmount: numeric("CreditAmount").notNull(),
	narration: text("Narration"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_VoucherDetails_LedgerId").using("btree", table.ledgerId.asc().nullsLast().op("uuid_ops")),
	index("IX_VoucherDetails_VoucherHeaderId").using("btree", table.voucherHeaderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ledgerId],
			foreignColumns: [ledgers.id],
			name: "FK_VoucherDetails_Ledgers_LedgerId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.voucherHeaderId],
			foreignColumns: [voucherHeaders.id],
			name: "FK_VoucherDetails_VoucherHeaders_VoucherHeaderId"
		}).onDelete("cascade"),
]);

export const voucherHeaders = pgTable("VoucherHeaders", {
	id: uuid("Id").primaryKey().notNull(),
	voucherNumber: text("VoucherNumber").notNull(),
	voucherType: integer("VoucherType").notNull(),
	voucherDate: timestamp("VoucherDate", { withTimezone: true, mode: 'string' }).notNull(),
	narration: text("Narration"),
	totalAmount: numeric("TotalAmount").notNull(),
	referenceId: uuid("ReferenceId"),
	referenceType: text("ReferenceType"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_VoucherHeaders_VoucherNumber").using("btree", table.voucherNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const invoices = pgTable("Invoices", {
	id: uuid("Id").primaryKey().notNull(),
	invoiceNumber: text("InvoiceNumber").notNull(),
	orderId: uuid("OrderId").notNull(),
	customerId: uuid("CustomerId").notNull(),
	invoiceDate: timestamp("InvoiceDate", { withTimezone: true, mode: 'string' }).notNull(),
	status: integer("Status").notNull(),
	subTotal: numeric("SubTotal").notNull(),
	cgstAmount: numeric("CgstAmount").notNull(),
	sgstAmount: numeric("SgstAmount").notNull(),
	igstAmount: numeric("IgstAmount").notNull(),
	totalAmount: numeric("TotalAmount").notNull(),
	supplyType: integer("SupplyType").notNull(),
	accountingEntryCreated: boolean("AccountingEntryCreated").notNull(),
	inventoryReduced: boolean("InventoryReduced").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_Invoices_CustomerId").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("IX_Invoices_InvoiceNumber").using("btree", table.invoiceNumber.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
	uniqueIndex("IX_Invoices_OrderId").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "FK_Invoices_Customers_CustomerId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "FK_Invoices_Orders_OrderId"
		}).onDelete("cascade"),
]);

export const orderItems = pgTable("OrderItems", {
	id: uuid("Id").primaryKey().notNull(),
	orderId: uuid("OrderId").notNull(),
	productId: uuid("ProductId").notNull(),
	quantity: numeric("Quantity", { precision: 18, scale:  3 }).notNull(),
	unitPrice: numeric("UnitPrice", { precision: 18, scale:  2 }).notNull(),
	taxRate: numeric("TaxRate").notNull(),
	lineTotal: numeric("LineTotal").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_OrderItems_OrderId").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("IX_OrderItems_ProductId").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "FK_OrderItems_Orders_OrderId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_OrderItems_Products_ProductId"
		}).onDelete("cascade"),
]);

export const productionBatchItems = pgTable("ProductionBatchItems", {
	id: uuid("Id").primaryKey().notNull(),
	productionBatchId: uuid("ProductionBatchId").notNull(),
	stockItemId: uuid("StockItemId").notNull(),
	quantityConsumed: numeric("QuantityConsumed").notNull(),
	quantityProduced: numeric("QuantityProduced").notNull(),
	unitCost: numeric("UnitCost").notNull(),
	stage: integer("Stage").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_ProductionBatchItems_ProductionBatchId").using("btree", table.productionBatchId.asc().nullsLast().op("uuid_ops")),
	index("IX_ProductionBatchItems_StockItemId").using("btree", table.stockItemId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productionBatchId],
			foreignColumns: [productionBatches.id],
			name: "FK_ProductionBatchItems_ProductionBatches_ProductionBatchId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.stockItemId],
			foreignColumns: [stockItems.id],
			name: "FK_ProductionBatchItems_StockItems_StockItemId"
		}).onDelete("cascade"),
]);

export const invoiceItems = pgTable("InvoiceItems", {
	id: uuid("Id").primaryKey().notNull(),
	invoiceId: uuid("InvoiceId").notNull(),
	productId: uuid("ProductId").notNull(),
	hsnCode: text("HsnCode").notNull(),
	quantity: numeric("Quantity").notNull(),
	unitPrice: numeric("UnitPrice").notNull(),
	taxRate: numeric("TaxRate").notNull(),
	cgstAmount: numeric("CgstAmount").notNull(),
	sgstAmount: numeric("SgstAmount").notNull(),
	igstAmount: numeric("IgstAmount").notNull(),
	lineTotal: numeric("LineTotal").notNull(),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
}, (table) => [
	index("IX_InvoiceItems_InvoiceId").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("IX_InvoiceItems_ProductId").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "FK_InvoiceItems_Invoices_InvoiceId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "FK_InvoiceItems_Products_ProductId"
		}).onDelete("cascade"),
]);

export const payments = pgTable("Payments", {
	id: uuid("Id").primaryKey().notNull(),
	invoiceId: uuid("InvoiceId"),
	customerId: uuid("CustomerId"),
	amount: numeric("Amount", { precision: 18, scale:  2 }).notNull(),
	method: integer("Method").notNull(),
	status: integer("Status").notNull(),
	paymentDate: timestamp("PaymentDate", { withTimezone: true, mode: 'string' }).notNull(),
	dueDate: timestamp("DueDate", { withTimezone: true, mode: 'string' }),
	referenceNumber: text("ReferenceNumber"),
	notes: text("Notes"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	index("IX_Payments_CustomerId").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("IX_Payments_InvoiceId").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "FK_Payments_Customers_CustomerId"
		}),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "FK_Payments_Invoices_InvoiceId"
		}),
]);

export const productCategories = pgTable("ProductCategories", {
	id: uuid("Id").primaryKey().notNull(),
	name: text("Name").notNull(),
	description: text("Description"),
	createdAt: timestamp("CreatedAt", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("UpdatedAt", { withTimezone: true, mode: 'string' }),
	isDeleted: boolean("IsDeleted").notNull(),
	createdBy: text("CreatedBy"),
	updatedBy: text("UpdatedBy"),
}, (table) => [
	uniqueIndex("IX_ProductCategories_Name").using("btree", table.name.asc().nullsLast().op("text_ops")).where(sql`("IsDeleted" = false)`),
]);

export const userRoles = pgTable("UserRoles", {
	userId: uuid("UserId").notNull(),
	roleId: uuid("RoleId").notNull(),
}, (table) => [
	index("IX_UserRoles_RoleId").using("btree", table.roleId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "FK_UserRoles_Roles_RoleId"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_UserRoles_Users_UserId"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.roleId], name: "PK_UserRoles"}),
]);

export const userLogins = pgTable("UserLogins", {
	loginProvider: text("LoginProvider").notNull(),
	providerKey: text("ProviderKey").notNull(),
	providerDisplayName: text("ProviderDisplayName"),
	userId: uuid("UserId").notNull(),
}, (table) => [
	index("IX_UserLogins_UserId").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_UserLogins_Users_UserId"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.loginProvider, table.providerKey], name: "PK_UserLogins"}),
]);

export const userTokens = pgTable("UserTokens", {
	userId: uuid("UserId").notNull(),
	loginProvider: text("LoginProvider").notNull(),
	name: text("Name").notNull(),
	value: text("Value"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "FK_UserTokens_Users_UserId"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.loginProvider, table.name], name: "PK_UserTokens"}),
]);

export const movementBatchLinks = pgTable("movement_batch_links", {
	movementId: integer("movement_id").notNull(),
	batchId: integer("batch_id").notNull(),
	qtyTaken: integer("qty_taken").notNull(),
	unitPricePaise: integer("unit_price_paise").notNull(),
	costPaise: integer("cost_paise").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.movementId],
			foreignColumns: [stockMovements.id],
			name: "movement_batch_links_movement_id_stock_movements_id_fk"
		}),
	foreignKey({
			columns: [table.batchId],
			foreignColumns: [batches.id],
			name: "movement_batch_links_batch_id_batches_id_fk"
		}),
	primaryKey({ columns: [table.movementId, table.batchId], name: "movement_batch_links_movement_id_batch_id_pk"}),
]);
