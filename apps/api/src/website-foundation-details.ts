import { z } from "zod";

export const websiteBusinessNameSchema = z.string().trim().min(2).max(180);
export const websiteFoundationContactPatchSchema = z.object({
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().max(254).email().or(z.literal("")).optional(),
  address: z.string().trim().max(1000).optional(),
  businessSummary: z.string().trim().max(4000).optional(),
  copyrightText: z.string().trim().max(500).optional(),
  receiveEnquiries: z.boolean().optional(),
  socialLinks: z.record(z.string().trim().url().refine(value => value.startsWith("https://"), "Use a complete https:// social profile URL.")).optional(),
}).passthrough();
