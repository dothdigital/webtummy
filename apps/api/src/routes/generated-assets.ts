import { Router } from "express";
import { prisma } from "@webtummy/db";
import { signedGeneratedObjectUrl } from "@webtummy/core/object-storage";
import { verifyGeneratedAssetDeliveryToken } from "../generated-assets.js";

export const publicGeneratedAssetsRouter = Router();

publicGeneratedAssetsRouter.get("/generated-assets/:assetId/content", async (req, res) => {
  if (!verifyGeneratedAssetDeliveryToken(req.params.assetId, req.query.token)) return res.status(403).json({ error: "This asset link is invalid." });
  const asset = await prisma.generatedAsset.findUnique({ where: { id: req.params.assetId } });
  if (!asset || asset.status !== "available") return res.status(404).json({ error: "Generated asset not found." });
  const url = await signedGeneratedObjectUrl({ bucket: asset.bucket, objectKey: asset.objectKey, filename: asset.originalFilename, contentType: asset.mimeType });
  res.setHeader("Cache-Control", asset.visibility === "published" ? "public, max-age=300" : "private, no-store");
  return res.redirect(302, url);
});
