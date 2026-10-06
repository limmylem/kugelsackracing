-- The economy's rules, kept by the database itself (docs/ECONOMY_SERVER.md):
--   * no balance below zero, no negative XP, conditions 0–100, a part loose or off only as the game has it;
--   * the ledger is append-only: no row changed or deleted (a mistake is reversed by a new row) — except when
--     an account is deleted (its rows go with it: the deletion sets kr.ledger_delete for its transaction);
--   * every ledger row follows on from the one before: balance_after = the last balance_after + amount;
--   * the balance a player has is the ledger's: kept in player_economy by this trigger, never by the app;
--   * a session pays out once (one reward row each), a transaction is reversed once;
--   * the build: a car's sockets hold the player's own cars' and parts' copies (and one copy in one place:
--     the unique index build_part_once, from 0005).
ALTER TABLE "player_economy" ADD CONSTRAINT "balance_never_negative" CHECK (balance >= 0);--> statement-breakpoint
ALTER TABLE "player_economy" ADD CONSTRAINT "xp_never_negative" CHECK (xp >= 0);--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_balance_never_negative" CHECK (balance_after >= 0);--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_amount_not_zero" CHECK (amount <> 0);--> statement-breakpoint
ALTER TABLE "owned_parts" ADD CONSTRAINT "condition_0_100" CHECK (condition >= 0 AND condition <= 100);--> statement-breakpoint
ALTER TABLE "owned_parts" ADD CONSTRAINT "attach_known" CHECK (attach IS NULL OR attach IN ('loose', 'detached'));--> statement-breakpoint
ALTER TABLE "economy_sessions" ADD CONSTRAINT "session_state_known" CHECK (state IN ('active', 'finished', 'failed', 'refunded', 'expired'));--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reward_once" ON "ledger" (session_id) WHERE kind = 'reward';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_fee_once" ON "ledger" (session_id) WHERE kind = 'entry_fee';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reversed_once" ON "ledger" (reverses) WHERE reverses IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reverses_fk" FOREIGN KEY (reverses) REFERENCES ledger(id);--> statement-breakpoint
ALTER TABLE "car_build_slots" ADD CONSTRAINT "build_car_fk" FOREIGN KEY (user_id, car_instance_id) REFERENCES owned_cars(user_id, instance_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "car_build_slots" ADD CONSTRAINT "build_part_fk" FOREIGN KEY (user_id, part_instance_id) REFERENCES owned_parts(user_id, instance_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_follow_on() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bigint;
BEGIN
  SELECT balance_after INTO prev FROM ledger WHERE user_id = NEW.user_id ORDER BY id DESC LIMIT 1;
  IF NEW.balance_after <> COALESCE(prev, 0) + NEW.amount THEN
    RAISE EXCEPTION 'ledger: balance_after % doesn''t follow on from % + %', NEW.balance_after, COALESCE(prev, 0), NEW.amount USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_follow_on BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION ledger_follow_on();--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_to_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE player_economy SET balance = NEW.balance_after, updated_at = now() WHERE user_id = NEW.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger: no economy for %', NEW.user_id; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_to_balance AFTER INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION ledger_to_balance();--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('kr.ledger_delete', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ledger: rows are never changed or deleted (reverse one instead)' USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
-- (the balance itself: only the ledger's trigger moves it)
CREATE OR REPLACE FUNCTION balance_from_ledger_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance IS DISTINCT FROM OLD.balance AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'player_economy: the balance only changes through the ledger' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER balance_from_ledger_only BEFORE UPDATE ON player_economy FOR EACH ROW EXECUTE FUNCTION balance_from_ledger_only();
