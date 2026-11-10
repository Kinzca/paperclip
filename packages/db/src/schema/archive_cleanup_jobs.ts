import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { ArchivedChatCleanupFile, ArchivedChatCleanupPlan } from "@paperclipai/shared";

/** Survives task deletion so failed physical cleanup stays visible and retryable. */
export const archiveCleanupJobs = pgTable("archive_cleanup_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"),
  files: jsonb("files").$type<ArchivedChatCleanupFile[]>().notNull(),
  retained: jsonb("retained").$type<ArchivedChatCleanupPlan["retained"]>().notNull().default([]),
  removedBytes: bigint("removed_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ pendingIdx: index("archive_cleanup_jobs_company_user_status_idx").on(table.companyId, table.userId, table.status) }));
