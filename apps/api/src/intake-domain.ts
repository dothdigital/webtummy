/** A reserved domain is not evidence of a live website. */
export function isOwnedDomainIntake(websiteStatus: string, answer: string): boolean {
  if (/(?:no|without|don['’]?t have|do not have)\s+(?:a\s+)?(?:(?:live|current|existing)\s+)?website/i.test(answer)) return true;
  if (/\b(?:website is (?:now )?live|(?:have|has) a live website)\b/i.test(answer)) return false;
  return ["new_website_required", "website_planned", "no_website_required"].includes(websiteStatus);
}
