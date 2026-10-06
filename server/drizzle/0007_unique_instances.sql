-- (every copy's id unique across all players: the server gives each player's new ids their own prefix — Phase 6 Step 2)
CREATE UNIQUE INDEX "owned_parts_instance_unique" ON "owned_parts" (instance_id);--> statement-breakpoint
CREATE UNIQUE INDEX "owned_cars_instance_unique" ON "owned_cars" (instance_id);
