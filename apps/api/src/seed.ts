// Seed the first super_admin. Run once: npm run -w @webtummy/api seed
// Override via env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
import { prisma } from "@webtummy/db";
import { hashPassword } from "./auth.js";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@webtummy.com";
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`super_admin ${email} already exists — nothing to do.`);
    return;
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      name: "Webtummy Admin",
      role: "super_admin",
    },
  });
  console.log(`Created super_admin: ${user.email}`);
  console.log(`Password: ${password}  (change it after first login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
