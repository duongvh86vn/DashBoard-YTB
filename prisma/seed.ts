import { createPrismaClient, seedInitialAdmin } from "../packages/db/src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!databaseUrl || !email || !password) {
  throw new Error(
    "DATABASE_URL, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD are required for bootstrap",
  );
}

const client = createPrismaClient(databaseUrl);

try {
  const result = await seedInitialAdmin({ email, password }, { client });
  process.stdout.write(`${result.status}\n`);
} finally {
  await client.$disconnect();
}
