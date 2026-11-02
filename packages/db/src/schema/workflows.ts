import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  unique,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import type {
  WorkflowPolicy,
  WorkflowSnapshot,
  WorkflowNodeState,
  WorkflowTemplate,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";

export const workflowTemplateRevisions = pgTable(
  "workflow_template_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    revision: integer("revision").notNull(),
    status: text("status").notNull().default("draft"),
    definition: jsonb("definition").$type<WorkflowTemplate>().notNull(),
    basedOnRevisionId: uuid("based_on_revision_id"),
    rationale: text("rationale").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    revisionUq: uniqueIndex("workflow_template_revisions_key_revision_uq").on(
      table.companyId,
      table.templateKey,
      table.revision,
    ),
    companyIdUq: unique("workflow_template_revisions_company_id_uq").on(
      table.companyId,
      table.id,
    ),
    statusCheck: check(
      "workflow_template_revisions_status_check",
      sql`${table.status} in ('draft', 'published')`,
    ),
  }),
);

export const workflowPolicies = pgTable(
  "workflow_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    version: integer("version").notNull().default(1),
    policy: jsonb("policy").$type<WorkflowPolicy>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("workflow_policies_company_uq")
      .on(table.companyId)
      .where(sql`${table.scope} = 'company'`),
    projectUq: uniqueIndex("workflow_policies_project_uq")
      .on(table.companyId, table.projectId)
      .where(sql`${table.scope} = 'project'`),
    scopeCheck: check(
      "workflow_policies_scope_check",
      sql`(${table.scope} = 'company' and ${table.projectId} is null) or (${table.scope} = 'project' and ${table.projectId} is not null)`,
    ),
  }),
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull(),
    status: text("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    snapshot: jsonb("snapshot").$type<WorkflowSnapshot>().notNull(),
    needsReconcile: boolean("needs_reconcile").notNull().default(true),
    nodes: jsonb("nodes").$type<Record<string, WorkflowNodeState>>().notNull(),
    stopReason: text("stop_reason"),
    pauseHoldId: uuid("pause_hold_id"),
    cancelRunIds: jsonb("cancel_run_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    cancelCheckIds: jsonb("cancel_check_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    issueUq: uniqueIndex("workflow_runs_issue_uq").on(table.issueId),
    companyIdUq: unique("workflow_runs_company_id_uq").on(
      table.companyId,
      table.id,
    ),
    pendingIdx: index("workflow_runs_pending_idx").on(
      table.status,
      table.deadlineAt,
    ),
    issueFk: foreignKey({
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
    }).onDelete("cascade"),
    statusCheck: check(
      "workflow_runs_status_check",
      sql`${table.status} in ('pending', 'running', 'paused', 'waiting_human', 'succeeded', 'cancelled')`,
    ),
  }),
);

export const workflowNodeAttempts = pgTable(
  "workflow_node_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    attempt: integer("attempt").notNull(),
    issueId: uuid("issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    ownerToken: uuid("owner_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    decisionUserId: text("decision_user_id"),
    decisionAgentId: uuid("decision_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    attemptUq: uniqueIndex("workflow_node_attempts_attempt_uq").on(
      table.runId,
      table.nodeId,
      table.attempt,
    ),
    issueIdx: index("workflow_node_attempts_issue_idx").on(
      table.companyId,
      table.issueId,
    ),
    runFk: foreignKey({
      columns: [table.companyId, table.runId],
      foreignColumns: [workflowRuns.companyId, workflowRuns.id],
    }).onDelete("cascade"),
    statusCheck: check(
      "workflow_node_attempts_status_check",
      sql`${table.status} in ('running', 'passed', 'failed', 'cancelled')`,
    ),
  }),
);

export const workflowEvaluations = pgTable(
  "workflow_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateRevisionId: uuid("candidate_revision_id").notNull(),
    baselineRunId: uuid("baseline_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    scenarioKey: text("scenario_key").notNull(),
    passed: boolean("passed").notNull(),
    findings: jsonb("findings").$type<string[]>().notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    trialUq: uniqueIndex("workflow_evaluations_trial_uq").on(
      table.candidateRevisionId,
      table.scenarioKey,
    ),
    candidateFk: foreignKey({
      columns: [table.companyId, table.candidateRevisionId],
      foreignColumns: [
        workflowTemplateRevisions.companyId,
        workflowTemplateRevisions.id,
      ],
    }).onDelete("cascade"),
    baselineFk: foreignKey({
      columns: [table.companyId, table.baselineRunId],
      foreignColumns: [workflowRuns.companyId, workflowRuns.id],
    }).onDelete("cascade"),
    candidateRunFk: foreignKey({
      columns: [table.companyId, table.candidateRunId],
      foreignColumns: [workflowRuns.companyId, workflowRuns.id],
    }).onDelete("cascade"),
  }),
);
