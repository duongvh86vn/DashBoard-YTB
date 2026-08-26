import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPoolConfig } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const upgradeSchema = `group_upgrade_${process.pid}_${Date.now().toString(36)}`;
if (!/^[a-z_][a-z0-9_]*$/u.test(upgradeSchema)) {
  throw new Error("Unsafe migration test schema identifier");
}

const basePool = new Pool(createPostgresPoolConfig(databaseUrl, 5_000, 10_000, 10_000));
let upgradePool: Pool | undefined;

function migrationPath(name: string): string {
  return fileURLToPath(
    new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url),
  );
}

async function applyMigration(pool: Pool, name: string): Promise<void> {
  await pool.query(await readFile(migrationPath(name), "utf8"));
}

describe("channel-group legacy upgrade migration", () => {
  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${upgradeSchema}"`);
    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set("schema", upgradeSchema);
    upgradePool = new Pool(createPostgresPoolConfig(scopedUrl.toString(), 5_000, 10_000, 10_000));

    await applyMigration(upgradePool, "20260822000000_phase1_auth_users");
    await applyMigration(upgradePool, "20260823000000_phase2_channels");
    await upgradePool.query(`
      INSERT INTO "users" (
        "id", "email", "password_hash", "role", "is_enabled", "updated_at"
      ) VALUES
        ('00000000-0000-4000-8000-000000000101', 'legacy-admin@example.com', 'hash', 'ADMIN', true, CURRENT_TIMESTAMP),
        ('00000000-0000-4000-8000-000000000102', 'legacy-viewer@example.com', 'hash', 'VIEWER', true, CURRENT_TIMESTAMP),
        ('00000000-0000-4000-8000-000000000103', 'legacy-disabled-viewer@example.com', 'hash', 'VIEWER', false, CURRENT_TIMESTAMP)
    `);
    await upgradePool.query(`
      INSERT INTO "channels" (
        "id", "youtube_channel_id", "original_input", "canonical_url", "title",
        "updated_at", "archived_at"
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000201', 'UC0000000000000000000201', '@legacy-active',
          'https://www.youtube.com/channel/UC0000000000000000000201', 'Legacy active',
          CURRENT_TIMESTAMP, NULL
        ),
        (
          '00000000-0000-4000-8000-000000000202', 'UC0000000000000000000202', '@legacy-archived',
          'https://www.youtube.com/channel/UC0000000000000000000202', 'Legacy archived',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    `);

    await applyMigration(upgradePool, "20260826000000_channel_groups");
    await applyMigration(upgradePool, "20260826010000_channel_group_audit");
  });

  afterAll(async () => {
    await upgradePool?.end();
    await basePool.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    await basePool.end();
  });

  it("creates one compatibility group for non-archived channels and every legacy VIEWER only", async () => {
    const pool = upgradePool!;
    const groups = await pool.query<{ id: string; slug: string }>(
      'SELECT "id", "slug" FROM "channel_groups" ORDER BY "id"',
    );
    expect(groups.rows).toHaveLength(1);
    expect(groups.rows[0]?.slug).toBe("tat-ca-kenh-hien-co");

    const channels = await pool.query<{ channelId: string }>(`
      SELECT "channel_id" AS "channelId"
      FROM "channel_group_channels"
      ORDER BY "channel_id"
    `);
    expect(channels.rows).toEqual([{ channelId: "00000000-0000-4000-8000-000000000201" }]);

    const viewers = await pool.query<{ userId: string }>(`
      SELECT "user_id" AS "userId"
      FROM "user_channel_groups"
      ORDER BY "user_id"
    `);
    expect(viewers.rows).toEqual([
      { userId: "00000000-0000-4000-8000-000000000102" },
      { userId: "00000000-0000-4000-8000-000000000103" },
    ]);
  });

  it("installs explicit semantic audit actions for every group mutation", async () => {
    const labels = await upgradePool!.query<{ enumlabel: string }>(`
      SELECT enum_value."enumlabel"
      FROM pg_enum AS enum_value
      INNER JOIN pg_type AS enum_type ON enum_type."oid" = enum_value."enumtypid"
      WHERE
        enum_type."typname" = 'AuditAction'
        AND enum_type."typnamespace" = to_regnamespace(current_schema())
      ORDER BY enum_value."enumsortorder"
    `);
    expect(labels.rows.map((row) => row.enumlabel)).toEqual(
      expect.arrayContaining([
        "CHANNEL_GROUP_CREATED",
        "CHANNEL_GROUP_UPDATED",
        "CHANNEL_GROUP_ARCHIVED",
        "CHANNEL_GROUP_CHANNELS_REPLACED",
        "VIEWER_CHANNEL_GROUPS_REPLACED",
      ]),
    );
  });
});
