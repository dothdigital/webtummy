import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StoredObject = {
  assetId: string;
  bucket: string;
  objectKey: string;
  versionId: string | null;
  etag: string | null;
  checksumSha256: string;
  sizeBytes: number;
};

const cleanSegment = (value: string, fallback: string) => value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
const prefix = () => (process.env.S3_UPLOAD_PREFIX || process.env.APP_ENV || "local").split("/").map((part) => cleanSegment(part, "assets")).join("/");
const bucket = () => process.env.S3_ASSETS_BUCKET?.trim() || "";
const region = () => process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "";

let cachedClient: S3Client | null = null;
function client() {
  if (!objectStorageConfigured()) throw new Error("S3 asset storage is not configured. Add AWS_REGION and S3_ASSETS_BUCKET.");
  if (!cachedClient) cachedClient = new S3Client({
    region: region(),
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" } : {}),
  });
  return cachedClient;
}

export function objectStorageConfigured() {
  return Boolean(bucket() && region());
}

export function generatedObjectKey(input: { workspaceId: string; projectId?: string | null; assetType: string; assetId: string; filename: string }) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const type = cleanSegment(input.assetType, "generated");
  const filename = cleanSegment(input.filename, `${input.assetId}.bin`);
  return [prefix(), "workspaces", cleanSegment(input.workspaceId, "workspace"), ...(input.projectId ? ["projects", cleanSegment(input.projectId, "project")] : []), type, year, month, input.assetId, filename].join("/");
}

export async function putGeneratedObject(input: { workspaceId: string; projectId?: string | null; assetType: string; filename: string; contentType: string; body: Buffer; source: string; assetId?: string; metadata?: Record<string, string> }): Promise<StoredObject> {
  const assetId = input.assetId || randomUUID();
  const objectKey = generatedObjectKey({ ...input, assetId });
  const checksum = createHash("sha256").update(input.body).digest();
  const response = await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: objectKey,
    Body: input.body,
    ContentType: input.contentType,
    ContentLength: input.body.length,
    ChecksumSHA256: checksum.toString("base64"),
    CacheControl: "private, no-store",
    ServerSideEncryption: process.env.S3_KMS_KEY_ID ? "aws:kms" : "AES256",
    ...(process.env.S3_KMS_KEY_ID ? { SSEKMSKeyId: process.env.S3_KMS_KEY_ID } : {}),
    Metadata: {
      workspace: cleanSegment(input.workspaceId, "workspace"),
      ...(input.projectId ? { project: cleanSegment(input.projectId, "project") } : {}),
      asset: assetId,
      source: cleanSegment(input.source, "system-generated"),
      ...(input.metadata ?? {}),
    },
  }));
  return { assetId, bucket: bucket(), objectKey, versionId: response.VersionId ?? null, etag: response.ETag?.replace(/^"|"$/g, "") ?? null, checksumSha256: checksum.toString("hex"), sizeBytes: input.body.length };
}

export async function signedGeneratedObjectUrl(input: { bucket: string; objectKey: string; filename?: string | null; contentType?: string | null; expiresIn?: number }) {
  const expiresIn = Math.max(60, Math.min(input.expiresIn ?? Number(process.env.S3_PRESIGN_TTL_SECONDS || 300), 3600));
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    ...(input.filename ? { ResponseContentDisposition: `inline; filename="${input.filename.replace(/["\\\r\n]/g, "-")}"` } : {}),
    ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
  }), { expiresIn });
}

export async function readGeneratedObject(input: { bucket: string; objectKey: string }) {
  const response = await client().send(new GetObjectCommand({ Bucket: input.bucket, Key: input.objectKey }));
  if (!response.Body) throw new Error("The generated asset has no stored content.");
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteGeneratedObject(input: { bucket: string; objectKey: string }) {
  await client().send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.objectKey }));
}
