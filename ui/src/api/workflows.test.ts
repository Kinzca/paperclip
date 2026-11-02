// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowsApi } from "./workflows";

afterEach(() => vi.unstubAllGlobals());
describe("account-specific workflow requests", () => {
  it("does not reuse an old account's pending response for the same company URL", async () => {
    const replies: ((value: Response) => void)[] = [];
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => replies.push(resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const old = workflowsApi.configuration("company-1");
    const current = workflowsApi.configuration("company-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    replies[1](
      new Response(
        JSON.stringify({
          platform: { version: 2, policy: {} },
          builtIn: [],
          revisions: [],
          policies: [],
        }),
      ),
    );
    replies[0](
      new Response(
        JSON.stringify({
          platform: { version: 1, policy: {} },
          builtIn: [],
          revisions: [],
          policies: [],
        }),
      ),
    );
    expect((await current).platform.version).toBe(2);
    expect((await old).platform.version).toBe(1);
  });
  it("cancels an abandoned account's read without aborting its replacement", async () => {
    const replies: ((value: Response) => void)[] = [];
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => replies.push(resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const old = workflowsApi.evaluations("company-1", "revision-1", {
      signal: controller.signal,
    });
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    const current = workflowsApi.evaluations("company-1", "revision-1");
    controller.abort();
    replies[1](new Response("[]"));
    replies[0](new Response("[]"));
    await rejected;
    expect(await current).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
