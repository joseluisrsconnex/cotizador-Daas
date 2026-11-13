import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { appUsersTable } from "./app-users";

export const quotesTable = pgTable("quotes", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => appUsersTable.id),
  requestId: uuid("request_id").notNull(),
  customer: text("customer").notNull(),
  quoteCode: text("quote_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => quoteVersionsTable.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => appUsersTable.id),
  termMonths: integer("term_months").notNull(),
  packageType: text("package_type").notNull(),
  serviceSelection: jsonb("service_selection"),
  scenarios: jsonb("scenarios"),
  forecast: text("forecast"),
  deliveryStatus: text("delivery_status").notNull().default(""),
  margin: doublePrecision("margin").notNull(),
  rows: jsonb("rows").notNull(),
  results: jsonb("results").notNull(),
  totalMonthlyBeforeTax: text("total_monthly_before_tax").notNull(),
  configSnapshot: jsonb("config_snapshot").notNull(),
}, table => [
  uniqueIndex("quotes_owner_request_idx").on(table.ownerId, table.requestId),
  uniqueIndex("quotes_active_code_idx").on(sql`lower(${table.quoteCode})`).where(sql`${table.deletedAt} IS NULL`),
  check("quotes_code_required", sql`${table.quoteCode} ~ '[^[:space:]]'`),
  index("quotes_owner_created_idx").on(table.ownerId, table.createdAt),
]);
export const insertQuoteSchema = createInsertSchema(quotesTable).omit({ createdAt: true });
export type QuoteRecord = typeof quotesTable.$inferSelect;

export const quoteVersionsTable = pgTable("quote_versions", {
  id: uuid("id").primaryKey(),
  quoteId: uuid("quote_id").notNull().references((): AnyPgColumn => quotesTable.id),
  versionNumber: integer("version_number").notNull(),
  requestId: uuid("request_id").notNull(),
  customer: text("customer").notNull(),
  quoteCode: text("quote_code").notNull(),
  proposalDetails: jsonb("proposal_details"),
  termMonths: integer("term_months").notNull(),
  packageType: text("package_type").notNull(),
  serviceSelection: jsonb("service_selection"),
  scenarios: jsonb("scenarios"),
  forecast: text("forecast"),
  deliveryStatus: text("delivery_status").notNull().default(""),
  rows: jsonb("rows").notNull(),
  results: jsonb("results").notNull(),
  totalMonthlyBeforeTax: text("total_monthly_before_tax").notNull(),
  configSnapshot: jsonb("config_snapshot").notNull(),
  margin: doublePrecision("margin").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsersTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("quote_versions_number_idx").on(table.quoteId, table.versionNumber),
  check("quote_versions_code_required", sql`${table.quoteCode} ~ '[^[:space:]]'`),
  uniqueIndex("quote_versions_request_idx").on(table.quoteId, table.requestId),
]);
export type QuoteVersionRecord = typeof quoteVersionsTable.$inferSelect;
