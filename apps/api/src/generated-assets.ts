import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import { deleteGeneratedObject, objectStorageConfigured, putGeneratedObject, readGeneratedObject, signedGeneratedObjectUrl } from "@webtummy/core/object-storage";
import { config } from "./config.js";

export type GeneratedAssetInput = {
  workspaceId: string;
  projectId?: string | null;
  assetType: string;
  mimeType: string;
  filename: string;
  body: Buffer;
  source: string;
  visibility?: "private" | "published";
  altText?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  dedupeKey?: string | null;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
};

function deliverySignature(assetId: string) {
  return createHmac("sha256", config.appEncryptionKey).update(`generated-asset:${assetId}`).digest("hex");
}

export function generatedAssetDeliveryUrl(assetId: string) {
  return `${config.publicApiUrl.replace(/\/$/, "")}/api/public/generated-assets/${encodeURIComponent(assetId)}/content?token=${deliverySignature(assetId)}`;
}

export function verifyGeneratedAssetDeliveryToken(assetId: string, token: unknown) {
  const expected = deliverySignature(assetId);
  const supplied = typeof token === "string" ? token : "";
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function objectMetadata(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (raw == null) return [];
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (!normalizedKey) return [];
    const normalizedValue = String(raw).replace(/[^\x20-\x7E]+/g, " ").trim().slice(0, 500);
    return normalizedValue ? [[normalizedKey, normalizedValue]] : [];
  }));
}

export async function storeGeneratedAsset(input: GeneratedAssetInput) {
  if (!objectStorageConfigured()) {
    if (process.env.S3_ASSETS_REQUIRED === "true") throw new Error("Generated asset storage is required but S3 is not configured.");
    return null;
  }
  const checksumSha256 = createHash("sha256").update(input.body).digest("hex");
  const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${checksumSha256.slice(0, 16)}`.slice(0, 191) : null;
  if (dedupeKey) {
    const existing = await prisma.generatedAsset.findUnique({ where: { dedupeKey } });
    if (existing && existing.checksumSha256 === checksumSha256 && existing.status === "available") return { ...existing, deliveryUrl: generatedAssetDeliveryUrl(existing.id) };
  }
  const uploaded = await putGeneratedObject({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assetType: input.assetType,
    filename: input.filename,
    contentType: input.mimeType,
    body: input.body,
    source: input.source,
    metadata: objectMetadata(input.metadata),
  });
  try {
    const asset = await prisma.generatedAsset.create({ data: {
      id: uploaded.assetId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      versionId: uploaded.versionId,
      etag: uploaded.etag,
      assetType: input.assetType,
      mimeType: input.mimeType,
      sizeBytes: uploaded.sizeBytes,
      checksumSha256: uploaded.checksumSha256,
      visibility: input.visibility ?? "private",
      source: input.source,
      originalFilename: input.filename,
      altText: input.altText ?? null,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      dedupeKey,
      createdByUserId: input.createdByUserId ?? null,
      metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
    } });
    return { ...asset, deliveryUrl: generatedAssetDeliveryUrl(asset.id) };
  } catch (error) {
    await deleteGeneratedObject({ bucket: uploaded.bucket, objectKey: uploaded.objectKey }).catch(() => undefined);
    if (dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.generatedAsset.findUnique({ where: { dedupeKey } });
      if (existing && existing.status === "available") return { ...existing, deliveryUrl: generatedAssetDeliveryUrl(existing.id) };
    }
    throw error;
  }
}

export function decodeImageDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([a-z0-9+/=_-]+)$/i);
  if (!match) throw new Error("Generated image is not a supported base64 PNG, JPEG, WebP, or SVG.");
  const mimeType = match[1].toLowerCase();
  const body = Buffer.from(match[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const valid = mimeType === "image/png"
    ? body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === "image/jpeg"
      ? body.length >= 4 && body[0] === 0xff && body[1] === 0xd8 && body[body.length - 2] === 0xff && body[body.length - 1] === 0xd9
      : mimeType === "image/webp"
        ? body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP"
        : body.length > 0;
  if (!valid) throw new Error(`Image bytes do not match the declared ${mimeType} type.`);
  return { mimeType, body };
}

export async function storeGeneratedImage(input: Omit<GeneratedAssetInput, "body" | "mimeType" | "assetType"> & { dataUrl: string }) {
  const decoded = decodeImageDataUrl(input.dataUrl);
  const asset = await storeGeneratedAsset({ ...input, ...decoded, assetType: "generated-images" });
  return asset?.deliveryUrl ?? input.dataUrl;
}

export async function readGeneratedAsset(assetId: string) {
  const asset = await prisma.generatedAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== "available") return null;
  const body = await readGeneratedObject({ bucket: asset.bucket, objectKey: asset.objectKey });
  return { asset, body };
}
