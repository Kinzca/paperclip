import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import type { Db } from "@paperclipai/db";
import { HttpError } from "../errors.js";
import { workflowRoutes } from "./workflows.js";
import type { workflowEngine } from "../services/workflows/engine.js";

vi.mock("../services/workflows/store.js", () => ({
  workflowStore: () => ({}),
}));
const acl = vi.hoisted(() => vi.fn());
vi.mock("../services/authorization.js", () => ({
  issueReadSqlCondition: acl,
  projectReadSqlCondition: vi.fn(),
}));
const companyId = "382ea922-5739-4087-9ad5-8a6523140cac";
const revisionId = "11111111-1111-4111-8111-111111111111";
let draft: Record<string, unknown>[];
let rows: Record<string, unknown>[];
let conditions: SQL[];
let joins: SQL[];
let limits: number[];
let offsets: number[];
let orders: unknown[][];
let selects: ReturnType<typeof vi.fn>;

function app(actorType = "board", companies = [companyId]) {
  const db = { select: selects } as unknown as Db;
  const instance = express();
  instance.use((req, _res, next) => {
    req.actor = {
      type: actorType,
      userId: "user-1",
      companyIds: companies,
      source: "session",
      isInstanceAdmin: false,
    } as typeof req.actor;
    next();
  });
  instance.use(
    "/api",
    workflowRoutes(db, {} as ReturnType<typeof workflowEngine>),
  );
  instance.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(
          error instanceof ZodError
            ? 400
            : error instanceof HttpError
              ? error.status
              : 500,
        )
        .json({ error: error.message }),
  );
  return instance;
}

beforeEach(() => {
  conditions = [];
  joins = [];
  limits = [];
  offsets = [];
  orders = [];
  draft = [
    {
      id: revisionId,
      templateKey: "game-development",
      basedOnRevisionId: null,
    },
  ];
  rows = [
    {
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "AIG-1",
      issueTitle: "Current title",
      objective: {
        plan: null,
        title: "Frozen objective",
        description: "Original scope",
      },
      createdAt: new Date(),
      finishedAt: new Date(),
    },
  ];
  acl.mockResolvedValue(sql`private_task_visible = true`);
  selects = vi.fn((_selection?: unknown) => {
    const result = selects.mock.calls.length === 1 ? draft : rows;
    let predicate: SQL;
    const chain = {
      from: () => chain,
      innerJoin: (_table: unknown, condition: SQL) => {
        joins.push(condition);
        return chain;
      },
      where: (condition: SQL) => {
        predicate = condition;
        conditions.push(condition);
        return chain;
      },
      orderBy: (...values: unknown[]) => {
        orders.push(values);
        return chain;
      },
      limit: (value: number) => {
        limits.push(value);
        return chain;
      },
      offset: (value: number) => {
        offsets.push(value);
        return chain;
      },
      getSQL: (): SQL => sql`select id from workflow_runs where ${predicate}`,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return chain;
  });
});

const url = `/api/companies/${companyId}/workflows/revisions/${revisionId}/baselines`;
describe("workflow baseline selection boundary", () => {
  it("returns bounded task metadata with a fingerprint of the same frozen objective used by trials", async () => {
    const response = await request(app()).get(`${url}?limit=1`);
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      objectiveTitle: "Frozen objective",
      issueTitle: "Current title",
      objectiveFingerprint: createHash("sha256")
        .update(JSON.stringify(rows[0].objective))
        .digest("hex"),
    });
    expect(response.body.items[0]).not.toHaveProperty("objective");
    expect(acl).toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(conditions[1]);
    expect(query.sql).toContain("private_task_visible = true");
    expect(query.sql).toContain('"issues"."company_id"');
    expect(query.sql).toContain('"workflow_runs"."company_id"');
    expect(query.sql).toContain("revisionId");
    expect(query.params).toContain("succeeded");
    expect(query.params).toContain("game-development");
  });
  it("matches the exact published base revision when one is pinned", async () => {
    draft[0].basedOnRevisionId = "published-base";
    const response = await request(app()).get(url);
    expect(response.status).toBe(200);
    const query = new PgDialect().sqlToQuery(conditions[1]);
    expect(query.params).toContain("published-base");
    expect(query.params).not.toContain("game-development");
  });
  it("uses standard baseline runs for a new custom template", async () => {
    draft[0].templateKey = "studio-custom";
    await request(app()).get(url);
    expect(new PgDialect().sqlToQuery(conditions[1]).params).toContain(
      "standard",
    );
  });
  it("rejects agents and other companies before reading candidate data", async () => {
    expect((await request(app("agent")).get(url)).status).toBe(403);
    expect((await request(app("board", [])).get(url)).status).toBe(403);
    expect(selects).not.toHaveBeenCalled();
  });
  it("bounds search and pagination at the request boundary", async () => {
    expect((await request(app()).get(`${url}?limit=1000`)).status).toBe(400);
    expect((await request(app()).get(`${url}?offset=-1`)).status).toBe(400);
    expect(selects).not.toHaveBeenCalled();
  });
  it("does not expose revisions that are missing, published, or outside the company query", async () => {
    draft = [];
    expect((await request(app()).get(url)).status).toBe(404);
    expect(selects).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(conditions[0]);
    expect(query.params).toContain(companyId);
    expect(query.params).toContain("draft");
  });
  it("paginates with a lookahead and stable two-column ordering", async () => {
    rows.push({ ...rows[0], id: "run-2" });
    const response = await request(app()).get(`${url}?limit=1&offset=20`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.hasMore).toBe(true);
    expect(limits).toEqual([2]);
    expect(offsets).toEqual([20]);
    expect(orders[0]).toHaveLength(2);
  });
  it("treats search wildcards literally and rejects oversized queries", async () => {
    await request(app()).get(url).query({ q: "a%_\\b" });
    const query = new PgDialect().sqlToQuery(conditions[1]);
    expect(query.params).toContain("%a\\%\\_\\\\b%");
    expect(
      (
        await request(app())
          .get(url)
          .query({ q: "a".repeat(201) })
      ).status,
    ).toBe(400);
  });
  it("keeps both evaluation tasks under root-task ACL and company-scoped joins", async () => {
    const response = await request(app()).get(
      url.replace("/baselines", "/evaluations"),
    );
    expect(response.status).toBe(200);
    const selection = selects.mock.calls[1][0] as Record<string, unknown>;
    expect(selection).toHaveProperty("objectiveTitle");
    expect(selection).toHaveProperty("baselineIssueId");
    expect(selection).toHaveProperty("candidateIssueId");
    const query = new PgDialect().sqlToQuery(conditions[1]);
    expect(query.sql.match(/private_task_visible = true/g)).toHaveLength(2);
    expect(query.sql).toContain('"workflow_evaluations"."baseline_run_id" in');
    expect(query.sql).toContain('"workflow_evaluations"."candidate_run_id" in');
    expect(
      joins
        .slice(-2)
        .every((condition) =>
          new PgDialect().sqlToQuery(condition).params.includes(companyId),
        ),
    ).toBe(true);
  });
});
