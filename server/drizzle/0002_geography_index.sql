-- Nearby queries measure in metres on the sphere (geography): their own index, on the point as geography.
CREATE INDEX IF NOT EXISTS "content_geog" ON "content_items" USING gist ((geom::geography));
