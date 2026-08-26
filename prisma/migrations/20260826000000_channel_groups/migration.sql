BEGIN;

CREATE TABLE "channel_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "description" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "channel_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_groups_slug_key" UNIQUE ("slug")
);

CREATE TABLE "channel_group_channels" (
    "group_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_group_channels_pkey" PRIMARY KEY ("group_id", "channel_id"),
    CONSTRAINT "channel_group_channels_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "channel_groups"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_group_channels_channel_id_fkey"
        FOREIGN KEY ("channel_id") REFERENCES "channels"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "user_channel_groups" (
    "user_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_user_id" UUID,

    CONSTRAINT "user_channel_groups_pkey" PRIMARY KEY ("user_id", "group_id"),
    CONSTRAINT "user_channel_groups_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_channel_groups_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "channel_groups"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_channel_groups_assigned_by_user_id_fkey"
        FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "channel_groups_archived_name_idx"
    ON "channel_groups"("archived_at", "name");
CREATE INDEX "channel_group_channels_channel_group_idx"
    ON "channel_group_channels"("channel_id", "group_id");
CREATE INDEX "user_channel_groups_group_user_idx"
    ON "user_channel_groups"("group_id", "user_id");
CREATE INDEX "user_channel_groups_assigned_by_idx"
    ON "user_channel_groups"("assigned_by_user_id");

-- Preserve the pre-group VIEWER behavior during an upgrade. Administrators can
-- narrow these assignments after deployment. Fresh installs retain this empty
-- default group until channels and VIEWER accounts are explicitly assigned.
DO $$
DECLARE
    default_group_id UUID;
BEGIN
    SELECT "id"
      INTO default_group_id
      FROM "channel_groups"
     WHERE "slug" = 'tat-ca-kenh-hien-co';

    IF default_group_id IS NULL THEN
        INSERT INTO "channel_groups" ("name", "slug", "description")
        VALUES (
            'Tất cả kênh hiện có',
            'tat-ca-kenh-hien-co',
            'Nhóm tương thích được tạo khi nâng cấp để giữ quyền xem hiện tại.'
        )
        RETURNING "id" INTO default_group_id;
    END IF;

    INSERT INTO "channel_group_channels" ("group_id", "channel_id")
    SELECT default_group_id, "id"
      FROM "channels"
     WHERE "archived_at" IS NULL
    ON CONFLICT ("group_id", "channel_id") DO NOTHING;

    INSERT INTO "user_channel_groups" ("user_id", "group_id")
    SELECT "id", default_group_id
      FROM "users"
     WHERE "role" = 'VIEWER'
    ON CONFLICT ("user_id", "group_id") DO NOTHING;
END $$;

COMMIT;
