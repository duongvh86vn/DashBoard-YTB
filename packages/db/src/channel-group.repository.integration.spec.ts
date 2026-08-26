import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ChannelUnitOfWork } from "./channel-unit-of-work.js";
import { createPrismaClient } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const client = createPrismaClient(databaseUrl);
const unitOfWork = new ChannelUnitOfWork(client);

async function resetGroupFixtures(): Promise<void> {
  await client.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "channel_group_channels_forced_failure" ON "channel_group_channels"',
  );
  await client.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "user_channel_groups_forced_failure" ON "user_channel_groups"',
  );
  await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS "force_group_membership_failure"()');
  await client.auditLog.deleteMany();
  await client.userChannelGroup.deleteMany();
  await client.channelGroupChannel.deleteMany();
  await client.channelGroup.deleteMany();
  await client.aiVideoAnalysis.deleteMany();
  await client.videoSnapshot.deleteMany();
  await client.video.deleteMany();
  await client.aiChannelClassification.deleteMany();
  await client.channelHealthCheck.deleteMany();
  await client.channelDailyStat.deleteMany();
  await client.channelSnapshot.deleteMany();
  await client.syncRun.deleteMany();
  await client.channel.deleteMany();
  await client.session.deleteMany();
  await client.user.deleteMany();
}

async function createUser(label: string, role: "ADMIN" | "VIEWER" = "VIEWER") {
  return client.user.create({
    data: {
      email: `${label}@group-integration.example`,
      passwordHash: "integration-password-hash",
      role,
    },
  });
}

async function createChannel(label: number, archived = false) {
  const youtubeChannelId = `UC${String(label).padStart(22, "0")}`;
  return client.channel.create({
    data: {
      youtubeChannelId,
      originalInput: `@group-${label}`,
      canonicalUrl: `https://www.youtube.com/channel/${youtubeChannelId}`,
      title: `Group channel ${label}`,
      ...(archived ? { archivedAt: new Date("2026-08-25T00:00:00.000Z") } : {}),
    },
  });
}

async function createGroup(label: string, archived = false) {
  return client.channelGroup.create({
    data: {
      name: `Group ${label}`,
      slug: `group-${label}`,
      description: null,
      ...(archived ? { archivedAt: new Date("2026-08-25T00:00:00.000Z") } : {}),
    },
  });
}

async function installInsertFailureTrigger(input: {
  table: "channel_group_channels" | "user_channel_groups";
  trigger: "channel_group_channels_forced_failure" | "user_channel_groups_forced_failure";
  column: "channel_id" | "group_id";
  value: string;
}): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "force_group_membership_failure"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'forced membership insert failure';
    END;
    $$
  `);
  await client.$executeRawUnsafe(`
    CREATE TRIGGER "${input.trigger}"
    BEFORE INSERT ON "${input.table}"
    FOR EACH ROW
    WHEN (NEW."${input.column}" = '${input.value}'::uuid)
    EXECUTE FUNCTION "force_group_membership_failure"()
  `);
}

describe("ChannelGroupRepository against PostgreSQL", () => {
  beforeEach(resetGroupFixtures);

  afterAll(async () => {
    await resetGroupFixtures();
    await client.$disconnect();
  });

  it("returns an empty visible-channel set for a VIEWER with zero groups", async () => {
    const viewer = await createUser("zero-group-viewer");

    await expect(
      unitOfWork.transaction((repositories) =>
        repositories.channelGroups.accessibleChannelIdsForUser(viewer.id),
      ),
    ).resolves.toEqual([]);
  });

  it("unions and deduplicates active memberships while excluding archived groups and channels", async () => {
    const viewer = await createUser("union-viewer");
    const first = await createChannel(1);
    const second = await createChannel(2);
    const archivedChannel = await createChannel(3, true);
    const firstGroup = await createGroup("union-a");
    const secondGroup = await createGroup("union-b");
    const archivedGroup = await createGroup("archived", true);

    await client.channelGroupChannel.createMany({
      data: [
        { groupId: firstGroup.id, channelId: first.id },
        { groupId: firstGroup.id, channelId: archivedChannel.id },
        { groupId: secondGroup.id, channelId: first.id },
        { groupId: secondGroup.id, channelId: second.id },
        { groupId: archivedGroup.id, channelId: archivedChannel.id },
      ],
    });
    await client.userChannelGroup.createMany({
      data: [firstGroup.id, secondGroup.id, archivedGroup.id].map((groupId) => ({
        userId: viewer.id,
        groupId,
      })),
    });

    await expect(
      unitOfWork.transaction((repositories) =>
        repositories.channelGroups.accessibleChannelIdsForUser(viewer.id),
      ),
    ).resolves.toEqual([first.id, second.id].sort());
  });

  it("rolls back channel membership deletion when the replacement insert fails", async () => {
    const group = await createGroup("atomic-channels");
    const original = await createChannel(4);
    const replacement = await createChannel(5);
    await client.channelGroupChannel.create({
      data: { groupId: group.id, channelId: original.id },
    });
    await installInsertFailureTrigger({
      table: "channel_group_channels",
      trigger: "channel_group_channels_forced_failure",
      column: "channel_id",
      value: replacement.id,
    });

    await expect(
      unitOfWork.transaction((repositories) =>
        repositories.channelGroups.replaceChannels(group.id, [replacement.id]),
      ),
    ).rejects.toThrow();

    const memberships = await client.channelGroupChannel.findMany({
      where: { groupId: group.id },
      select: { channelId: true },
    });
    expect(memberships).toEqual([{ channelId: original.id }]);
  });

  it("rolls back VIEWER membership deletion when the replacement insert fails", async () => {
    const admin = await createUser("membership-admin", "ADMIN");
    const viewer = await createUser("atomic-viewer");
    const original = await createGroup("atomic-viewer-a");
    const replacement = await createGroup("atomic-viewer-b");
    await client.userChannelGroup.create({
      data: {
        userId: viewer.id,
        groupId: original.id,
        assignedByUserId: admin.id,
      },
    });
    await installInsertFailureTrigger({
      table: "user_channel_groups",
      trigger: "user_channel_groups_forced_failure",
      column: "group_id",
      value: replacement.id,
    });

    await expect(
      unitOfWork.transaction((repositories) =>
        repositories.channelGroups.replaceViewerGroups({
          userId: viewer.id,
          groupIds: [replacement.id],
          assignedByUserId: admin.id,
        }),
      ),
    ).rejects.toThrow();

    const memberships = await client.userChannelGroup.findMany({
      where: { userId: viewer.id },
      select: { groupId: true, assignedByUserId: true },
    });
    expect(memberships).toEqual([{ groupId: original.id, assignedByUserId: admin.id }]);
  });

  it("rolls back a group mutation when the audit append fails in PostgreSQL", async () => {
    const slug = "audit-failure-rollback";

    await expect(
      unitOfWork.transaction(async (repositories) => {
        const created = await repositories.channelGroups.create({
          name: "Audit failure rollback",
          slug,
          description: null,
        });
        await repositories.audit.append({
          actorUserId: "00000000-0000-4000-8000-000000000999",
          targetUserId: null,
          action: "CHANNEL_GROUP_CREATED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { channelGroupId: created.id },
        });
      }),
    ).rejects.toThrow();

    await expect(client.channelGroup.findUnique({ where: { slug } })).resolves.toBeNull();
    await expect(client.auditLog.count()).resolves.toBe(0);
  });
});
