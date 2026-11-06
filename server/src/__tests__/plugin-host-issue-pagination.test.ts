import { describe, expect, it, vi } from "vitest";
import { buildHostServices } from "../services/plugin-host-services.js";

const list = vi.hoisted(() => vi.fn());
vi.mock("../services/issues.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/issues.js")>(),
  issueService: () => ({ list }),
}));

describe("plugin issue list pagination", () => {
  it("returns the SQL page once while preserving company and privacy filters", async () => {
    const page = [{ id: "second-page-task" }];
    list.mockResolvedValue(page);
    const events = { forPlugin: () => ({ emit: vi.fn(), subscribe: vi.fn(), clear: vi.fn() }) };
    const services = buildHostServices({} as never, "record-id", "wiki", events as never);
    const actual = await services.issues.list({
      companyId: "11111111-1111-4111-8111-111111111111", status: "done", offset: 100, limit: 100,
    });
    expect(actual).toEqual(page);
    expect(list).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", expect.objectContaining({
      status: "done", offset: 100, limit: 100, readCondition: expect.anything(),
    }));
    services.dispose();
  });
});
