import type { Db } from "@paperclipai/db";
import {
  logActivity,
  publishActivity,
  type ActivityPublication,
  type LogActivityInput,
} from "../activity-log.js";
import {
  executeIssuePostCommitActions,
  issueService,
  type IssuePostCommitAction,
} from "../issues.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface WorkflowTransaction {
  tx: Transaction;
  activity: (input: LogActivityInput) => Promise<unknown>;
  updateIssue: (
    id: string,
    data: Parameters<ReturnType<typeof issueService>["update"]>[1],
  ) => Promise<unknown>;
}

/** Publish only committed changes, including the issue service's deferred effects. */
export async function workflowTransaction<T>(
  db: Db,
  operation: (context: WorkflowTransaction) => Promise<T>,
) {
  const publications: ActivityPublication[] = [];
  const actions: IssuePostCommitAction[] = [];
  const tasks = issueService(db);
  const result = await db.transaction((tx) =>
    operation({
      tx,
      activity: (input) =>
        logActivity(tx as unknown as Db, input, publications),
      updateIssue: (id, data) =>
        tasks.update(id, data, tx, publications, actions, {
          workflowTransition: true,
        }),
    }),
  );
  for (const publication of publications) publishActivity(publication);
  await executeIssuePostCommitActions(db, actions);
  return result;
}
