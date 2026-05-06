-- Add new roles[] column with empty default, backfill from existing role, drop old column.

ALTER TABLE "User" ADD COLUMN "roles" "RoleName"[] NOT NULL DEFAULT '{}';

UPDATE "User" SET "roles" = ARRAY["role"]::"RoleName"[] WHERE "role" IS NOT NULL;

ALTER TABLE "User" DROP COLUMN "role";

ALTER TABLE "User" ALTER COLUMN "roles" SET DEFAULT ARRAY['ops_manager']::"RoleName"[];
