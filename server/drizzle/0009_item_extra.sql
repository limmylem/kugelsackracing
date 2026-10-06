-- (Phase 6 Step 4) what else a car or part copy carries: a part's purchase (boughtAt: the refund window) and
-- whether it's been fitted (used); a car's body price (what its body was bought for) and, bought used, its
-- listing, mileage and history (garage/shop.js)
ALTER TABLE "owned_parts" ADD COLUMN IF NOT EXISTS "extra" jsonb;--> statement-breakpoint
ALTER TABLE "owned_cars" ADD COLUMN IF NOT EXISTS "extra" jsonb;
