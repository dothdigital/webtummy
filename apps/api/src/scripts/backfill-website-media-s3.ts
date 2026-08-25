import { createHash } from "node:crypto";
import { prisma } from "@webtummy/db";
import { decodeImageDataUrl, readGeneratedAsset, storeGeneratedAsset } from "../generated-assets.js";

const apply = process.argv.includes("--apply");

async function main() {
  const assets = await prisma.websiteBuildMediaAsset.findMany({
    where: { sourceUrl: { startsWith: "data:image/" } },
    orderBy: { createdAt: "asc" },
    include: { build: { select: { projectId: true, project: { select: {
      agencyClient: { select: { workspaceId: true } },
      client: { select: { workspace: { select: { id: true } } } },
    } } } } },
  });
  const totalBytes = assets.reduce((sum, asset) => sum + Buffer.byteLength(asset.sourceUrl || ""), 0);
  console.log(`[website-media-backfill] ${apply ? "apply" : "dry-run"}: ${assets.length} inline asset(s), ${totalBytes} encoded bytes.`);
  if (!apply) return;

  let migrated = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const workspaceId = asset.build.project.agencyClient?.workspaceId ?? asset.build.project.client.workspace?.id;
      if (!workspaceId) throw new Error("The website project has no workspace owner.");
      const decoded = decodeImageDataUrl(asset.sourceUrl!);
      const sourceChecksum = createHash("sha256").update(decoded.body).digest("hex");
      const stored = await storeGeneratedAsset({
        workspaceId,
        projectId: asset.build.projectId,
        assetType: "website-images",
        mimeType: decoded.mimeType,
        filename: asset.fileName || `${asset.id}.${decoded.mimeType.split("/")[1].replace("jpeg", "jpg")}`,
        body: decoded.body,
        source: "website_media_backfill",
        altText: asset.altText,
        sourceEntityType: "website_build_media_asset",
        sourceEntityId: asset.id,
        dedupeKey: `website-media:${asset.id}`,
        metadata: { websiteMediaAssetId: asset.id, migration: "inline-to-s3-v1" },
      });
      if (!stored) throw new Error("S3 GeneratedAsset storage is not configured.");
      const verified = await readGeneratedAsset(stored.id);
      if (!verified) throw new Error("The uploaded GeneratedAsset could not be read back.");
      const storedChecksum = createHash("sha256").update(verified.body).digest("hex");
      if (sourceChecksum !== storedChecksum || stored.checksumSha256 !== sourceChecksum) throw new Error("S3 checksum verification failed.");
      await prisma.websiteBuildMediaAsset.updateMany({
        where: { id: asset.id, sourceUrl: asset.sourceUrl },
        data: { sourceUrl: stored.deliveryUrl, storageKey: `generated-asset:${stored.id}`, mimeType: decoded.mimeType },
      });
      migrated += 1;
      console.log(`[website-media-backfill] migrated ${asset.id} (${decoded.body.length} bytes, checksum ${sourceChecksum.slice(0, 12)}).`);
    } catch (error) {
      failed += 1;
      console.error(`[website-media-backfill] kept inline ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`[website-media-backfill] complete: ${migrated} migrated, ${failed} retained inline.`);
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
