CREATE INDEX "content_geom_published" ON "content_items" USING gist ("geom") WHERE view = 'published';--> statement-breakpoint
-- (nearby queries use the geometry indexes with a box and the sphere distance: the geography index is no longer used)
DROP INDEX IF EXISTS "content_geog";
