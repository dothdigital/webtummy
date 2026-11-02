import { Router } from "express";
import { prisma } from "@webtummy/db";
import { signedGeneratedObjectUrl } from "@webtummy/core/object-storage";
import { verifyGeneratedAssetDeliveryToken } from "../generated-assets.js";

export const publicGeneratedAssetsRouter = Router();

publicGeneratedAssetsRouter.get("/generated-assets/:assetId/content", async (req, res) => {
  if (!verifyGeneratedAssetDeliveryToken(req.params.assetId, req.query.token)) return res.status(403).json({ error: "This asset link is invalid." });
  const asset = await prisma.generatedAsset.findUnique({ where: { id: req.params.assetId } });
  if (!asset || asset.status !== "available") return res.status(404).json({ error: "Generated asset not found." });
  const metadata = asset.metadataJson && typeof asset.metadataJson === "object" && !Array.isArray(asset.metadataJson) ? asset.metadataJson as Record<string, unknown> : {};
  const expiresAt = typeof metadata.expiresAt === "string" ? new Date(metadata.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) return res.status(410).json({ error: "This secure download link has expired. Ask the sender for a new handoff link." });
  if (asset.assetType === "website-developer-handoff") {
    await prisma.generatedAsset.update({ where: { id: asset.id }, data: { metadataJson: { ...metadata, firstDownloadedAt: metadata.firstDownloadedAt || new Date().toISOString(), lastDownloadedAt: new Date().toISOString(), downloadCount: Number(metadata.downloadCount || 0) + 1 } } });
  }
  const url = await signedGeneratedObjectUrl({ bucket: asset.bucket, objectKey: asset.objectKey, filename: asset.originalFilename, contentType: asset.mimeType });
  res.setHeader("Cache-Control", asset.visibility === "published" ? "public, max-age=300" : "private, no-store");
  return res.redirect(302, url);
});
