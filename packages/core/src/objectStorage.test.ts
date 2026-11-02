import { afterEach, describe, expect, it } from "vitest";
import { generatedObjectKey, objectStorageConfigured } from "./objectStorage.js";

const original = {
  region: process.env.AWS_REGION,
  defaultRegion: process.env.AWS_DEFAULT_REGION,
  bucket: process.env.S3_ASSETS_BUCKET,
  prefix: process.env.S3_UPLOAD_PREFIX,
};

afterEach(() => {
  for (const [key, value] of Object.entries({ AWS_REGION: original.region, AWS_DEFAULT_REGION: original.defaultRegion, S3_ASSETS_BUCKET: original.bucket, S3_UPLOAD_PREFIX: original.prefix })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("generated asset object storage", () => {
  it("requires both a bucket and region", () => {
    process.env.AWS_REGION = "ca-central-1";
    delete process.env.S3_ASSETS_BUCKET;
    expect(objectStorageConfigured()).toBe(false);
    process.env.S3_ASSETS_BUCKET = "senuke-test-assets";
    expect(objectStorageConfigured()).toBe(true);
  });

  it("creates tenant-scoped safe keys", () => {
    process.env.S3_UPLOAD_PREFIX = "staging";
    const key = generatedObjectKey({ workspaceId: "Workspace / One", projectId: "Project Two", assetType: "PDFs", assetId: "asset-123", filename: "Quarterly Report (Final).PDF" });
    expect(key).toMatch(/^staging\/workspaces\/workspace-one\/projects\/project-two\/pdfs\/\d{4}\/\d{2}\/asset-123\/quarterly-report-final-.pdf$/);
    expect(key).not.toContain("..");
  });
});
