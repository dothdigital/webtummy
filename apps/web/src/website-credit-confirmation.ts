export type WebsiteCreditSummary = { pageCount: number; billablePageCount: number; includedPageCount: number; creditsPerPage: number; totalCredits: number };
export function websiteCreditConfirmationMessage(quote: WebsiteCreditSummary) {
  const { pageCount, billablePageCount, includedPageCount, creditsPerPage, totalCredits } = quote;
  if (![pageCount, billablePageCount, includedPageCount, creditsPerPage, totalCredits].every(n => Number.isSafeInteger(n) && n >= 0) || pageCount < 1 || billablePageCount + includedPageCount !== pageCount || totalCredits !== billablePageCount * creditsPerPage) throw new Error("The website cost estimate could not be verified. Please try again.");
  return [
    "Confirm website development",
    `${pageCount.toLocaleString()} page${pageCount === 1 ? "" : "s"} selected.`,
    `${billablePageCount.toLocaleString()} page${billablePageCount === 1 ? "" : "s"} × ${creditsPerPage.toLocaleString()} credits = ${totalCredits.toLocaleString()} credits.`,
    includedPageCount ? `${includedPageCount.toLocaleString()} previously paid or included page${includedPageCount === 1 ? "" : "s"} will not be charged again.` : "",
    "Includes page content and standard page images (up to 3 per page).",
    `Total credits to be used: ${totalCredits.toLocaleString()}.`,
    "Continue? Canceling will not use credits.",
  ].filter(Boolean).join("\n\n");
}
