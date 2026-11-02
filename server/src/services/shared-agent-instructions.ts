import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { companies, type Db } from "@paperclipai/db";
import { instanceSettingsService } from "./instance-settings.js";

/** Server-owned configuration, resolved anew for each admitted run. */
export async function resolveSharedAgentInstructions(db: Db, companyId: string) {
  const [general, company] = await Promise.all([
    instanceSettingsService(db).getGeneral(),
    db.select({ instructions: companies.agentInstructions }).from(companies)
      .where(eq(companies.id, companyId)).then(rows => rows[0]),
  ]);
  if (!company) throw new Error("Shared instructions company not found");
  const instance = general.agentInstructions?.trim() ?? "";
  const organization = company.instructions.trim();
  const text = [
    instance ? `### Instance-wide instructions\n\n${instance}` : "",
    organization ? `### Organization instructions\n\n${organization}` : "",
  ].filter(Boolean).join("\n\n");
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}
