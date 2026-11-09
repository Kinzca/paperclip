import { describe, expect, it } from "vitest";
import { attachmentArtifactWorkProductMetadataSchema, issueWorkProductMetadataSchema } from "./work-product.js";

describe("attachmentArtifactWorkProductMetadataSchema", () => {
  it("binds runtime and viewing declarations to a revision without implying QA", () => {
    const verification = { revision: "r1", execution: "scripted_runtime", viewing: "not_assessed" };
    expect(issueWorkProductMetadataSchema.parse({ verification }).verification).toEqual(verification);
    for (const patch of [{ revision: "" }, { viewing: "passed" }, { independentQaPassed: true },
      { media: { sha256: "a".repeat(64), byteSize: 0, durationSeconds: 1, decodedFrames: 1, maxPtsErrorSeconds: 0, candidateLabel: "candidate" } }]) {
      expect(issueWorkProductMetadataSchema.safeParse({ verification: { ...verification, ...patch } }).success).toBe(false);
    }
  });
  it("accepts the attachment-backed artifact metadata contract", () => {
    const parsed = attachmentArtifactWorkProductMetadataSchema.parse({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      contentType: "video/mp4",
      byteSize: 1234,
      contentPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      openPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      downloadPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content?download=1",
      originalFilename: "demo.mp4",
    });

    expect(parsed.contentType).toBe("video/mp4");
    expect(parsed.downloadPath).toContain("download=1");
  });

  it("rejects off-route or scriptable paths", () => {
    const parsed = attachmentArtifactWorkProductMetadataSchema.safeParse({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      contentType: "video/mp4",
      byteSize: 1234,
      contentPath: "https://evil.example/video.mp4",
      openPath: "javascript:alert(1)",
      downloadPath: "/api/attachments/11111111-1111-4111-8111-111111111111/content",
      originalFilename: "demo.mp4",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected invalid attachment artifact metadata");
    }
    expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "contentPath",
      "openPath",
      "downloadPath",
    ]);
  });
});
