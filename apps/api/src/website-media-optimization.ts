import sharp from "sharp";
import type { WebsiteModel } from "@webtummy/core/website-model";

type WebsiteImageRole = "hero" | "logo" | "favicon" | "background" | "content";

export type OptimizedWebsiteImage = {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
  originalBytes: number;
  optimized: boolean;
};

const embeddedImagePattern = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s_-]+)$/i;

function imagePolicy(role: WebsiteImageRole) {
  if (role === "hero" || role === "background") return { width: 1600, quality: 78 };
  if (role === "logo") return { width: 960, quality: 82 };
  if (role === "favicon") return { width: 512, quality: 88 };
  return { width: 1200, quality: 78 };
}

export async function optimizeWebsiteImage(
  bytes: Buffer,
  mimeType: string,
  role: WebsiteImageRole = "content",
): Promise<OptimizedWebsiteImage> {
  const normalizedMimeType = mimeType.toLowerCase();
  const originalBytes = bytes.length;
  if (!/^image\/(?:png|jpeg|webp)$/.test(normalizedMimeType)) {
    return { bytes, mimeType: normalizedMimeType, extension: normalizedMimeType === "image/jpeg" ? "jpg" : normalizedMimeType.split("/")[1] || "bin", width: null, height: null, originalBytes, optimized: false };
  }
  try {
    const source = sharp(bytes, { failOn: "warning", animated: false }).rotate();
    const metadata = await source.metadata();
    if ((metadata.pages ?? 1) > 1) {
      return { bytes, mimeType: normalizedMimeType, extension: normalizedMimeType === "image/jpeg" ? "jpg" : normalizedMimeType.split("/")[1], width: metadata.width ?? null, height: metadata.height ?? null, originalBytes, optimized: false };
    }
    const policy = imagePolicy(role);
    const optimizedBytes = await source
      .resize({ width: policy.width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: policy.quality, effort: 5, smartSubsample: true })
      .toBuffer();
    const outputMetadata = await sharp(optimizedBytes).metadata();
    // Avoid replacing an already efficient source with a larger encoding.
    if (optimizedBytes.length >= originalBytes && normalizedMimeType === "image/webp") {
      return { bytes, mimeType: normalizedMimeType, extension: "webp", width: metadata.width ?? null, height: metadata.height ?? null, originalBytes, optimized: false };
    }
    return {
      bytes: optimizedBytes,
      mimeType: "image/webp",
      extension: "webp",
      width: outputMetadata.width ?? null,
      height: outputMetadata.height ?? null,
      originalBytes,
      optimized: true,
    };
  } catch {
    // Publication must remain recoverable when a legacy or malformed image
    // cannot be decoded. The existing quality checks still surface it.
    return { bytes, mimeType: normalizedMimeType, extension: normalizedMimeType === "image/jpeg" ? "jpg" : normalizedMimeType.split("/")[1], width: null, height: null, originalBytes, optimized: false };
  }
}

export function websiteAssetRole(model: WebsiteModel, assetId: string): WebsiteImageRole {
  if (model.identity?.logoAssetId === assetId) return "logo";
  if (model.identity?.faviconAssetId === assetId) return "favicon";
  for (const page of model.pages) {
    for (const component of page.sections) {
      if (component.componentId === "hero.local_service" && component.props.imageAssetId === assetId) return "hero";
      if (component.componentId === "layout.section" && component.props.backgroundImageAssetId === assetId) return "background";
    }
  }
  return "content";
}

export async function optimizeEmbeddedWebsiteMedia(model: WebsiteModel): Promise<{
  model: WebsiteModel;
  optimizedCount: number;
  originalBytes: number;
  publishedBytes: number;
}> {
  let optimizedCount = 0;
  let originalBytes = 0;
  let publishedBytes = 0;
  const mediaAssets = await Promise.all(model.mediaAssets.map(async (asset) => {
    const match = asset.sourceUrl?.match(embeddedImagePattern);
    if (!match) return asset;
    const sourceBytes = Buffer.from(match[2].replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const optimized = await optimizeWebsiteImage(sourceBytes, match[1], websiteAssetRole(model, asset.assetId));
    originalBytes += optimized.originalBytes;
    publishedBytes += optimized.bytes.length;
    if (optimized.optimized) optimizedCount += 1;
    return {
      ...asset,
      sourceUrl: `data:${optimized.mimeType};base64,${optimized.bytes.toString("base64")}`,
    };
  }));
  return { model: { ...model, mediaAssets }, optimizedCount, originalBytes, publishedBytes };
}
