CREATE TABLE "workflow_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_revision_id" uuid NOT NULL,
	"baseline_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"passed" boolean NOT NULL,
	"findings" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_node_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"issue_id" uuid,
	"status" text NOT NULL,
	"evidence" jsonb,
	"owner_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"decision_user_id" text,
	"decision_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_node_attempts_status_check" CHECK ("workflow_node_attempts"."status" in ('running', 'passed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_policies_scope_check" CHECK (("workflow_policies"."scope" = 'company' and "workflow_policies"."project_id" is null) or ("workflow_policies"."scope" = 'project' and "workflow_policies"."project_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"needs_reconcile" boolean DEFAULT true NOT NULL,
	"nodes" jsonb NOT NULL,
	"stop_reason" text,
	"pause_hold_id" uuid,
	"cancel_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancel_check_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('pending', 'running', 'paused', 'waiting_human', 'succeeded', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow_template_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"based_on_revision_id" uuid,
	"rationale" text NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_template_revisions_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "workflow_template_revisions_status_check" CHECK ("workflow_template_revisions"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "workflow_evaluations" ADD CONSTRAINT "workflow_evaluations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_evaluations" ADD CONSTRAINT "workflow_evaluations_company_id_candidate_revision_id_workflow_template_revisions_company_id_id_fk" FOREIGN KEY ("company_id","candidate_revision_id") REFERENCES "public"."workflow_template_revisions"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_evaluations" ADD CONSTRAINT "workflow_evaluations_company_id_baseline_run_id_workflow_runs_company_id_id_fk" FOREIGN KEY ("company_id","baseline_run_id") REFERENCES "public"."workflow_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_evaluations" ADD CONSTRAINT "workflow_evaluations_company_id_candidate_run_id_workflow_runs_company_id_id_fk" FOREIGN KEY ("company_id","candidate_run_id") REFERENCES "public"."workflow_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_attempts" ADD CONSTRAINT "workflow_node_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_attempts" ADD CONSTRAINT "workflow_node_attempts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_attempts" ADD CONSTRAINT "workflow_node_attempts_company_id_run_id_workflow_runs_company_id_id_fk" FOREIGN KEY ("company_id","run_id") REFERENCES "public"."workflow_runs"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_policies" ADD CONSTRAINT "workflow_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_policies" ADD CONSTRAINT "workflow_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_revisions" ADD CONSTRAINT "workflow_template_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_evaluations_trial_uq" ON "workflow_evaluations" USING btree ("candidate_revision_id","scenario_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_node_attempts_attempt_uq" ON "workflow_node_attempts" USING btree ("run_id","node_id","attempt");--> statement-breakpoint
CREATE INDEX "workflow_node_attempts_issue_idx" ON "workflow_node_attempts" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_policies_company_uq" ON "workflow_policies" USING btree ("company_id") WHERE "workflow_policies"."scope" = 'company';--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_policies_project_uq" ON "workflow_policies" USING btree ("company_id","project_id") WHERE "workflow_policies"."scope" = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_issue_uq" ON "workflow_runs" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_pending_idx" ON "workflow_runs" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_revisions_key_revision_uq" ON "workflow_template_revisions" USING btree ("company_id","template_key","revision");