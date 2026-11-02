import type { WebsiteModel } from "@webtummy/core/website-model";

export function missingWebsiteReleaseRequirements(releaseModel: WebsiteModel) {
  const releaseRequirements: string[] = [];
  if (!releaseModel.identity?.businessName?.trim()) releaseRequirements.push("verified business name");
  if (!releaseModel.identity?.contactPhone?.trim()) releaseRequirements.push("verified business phone");
  if (!releaseModel.identity?.contactEmail?.trim()) releaseRequirements.push("verified business email");
  if (!releaseModel.identity?.copyrightText?.trim()) releaseRequirements.push("copyright text");
  const home = releaseModel.pages.find((page) => page.pageType === "home" || page.slug === "/" || /^(?:home|homepage)$/i.test(page.name));
  if (!home) releaseRequirements.push("Home page");
  else {
    if (home.sections[0]?.componentId !== "hero.local_service") releaseRequirements.push("Home hero as the first-fold section");
    const homeHero = home.sections.find((section) => section.componentId === "hero.local_service");
    const heroAssetId = typeof homeHero?.props.imageAssetId === "string" ? homeHero.props.imageAssetId.trim() : "";
    const approvedHero = releaseModel.mediaAssets.find((asset) => asset.assetId === heroAssetId && asset.status === "approved" && Boolean(asset.sourceUrl));
    if (!approvedHero) releaseRequirements.push("approved Home first-fold hero image");
  }
  return releaseRequirements;
}

export function assertWebsiteReleaseRequirements(releaseModel: WebsiteModel) {
  const releaseRequirements = missingWebsiteReleaseRequirements(releaseModel);
  if (releaseRequirements.length) {
    throw Object.assign(
      new Error(`Website approval is waiting for: ${releaseRequirements.join(", ")}.`),
      { statusCode: 409, releaseRequirements },
    );
  }
}
