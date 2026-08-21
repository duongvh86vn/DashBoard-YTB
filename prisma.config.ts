import "dotenv/config";

import { defineConfig } from "prisma/config";

// Generate/validate do not contact this deliberately unreachable fallback.
// Any command that connects to PostgreSQL must receive DATABASE_URL explicitly.
const nonConnectingDatabaseUrl = "postgresql://invalid:invalid@127.0.0.1:1/invalid";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? nonConnectingDatabaseUrl,
  },
});
