-- Add 'standard_room' as a PropertyType between partition and master_room.
-- Use the BEFORE clause so the enum ordering stays semantic (rooms cluster
-- together: bed_space → shared_room → partition → standard_room → master_room).

ALTER TYPE "PropertyType" ADD VALUE 'standard_room' BEFORE 'master_room';
