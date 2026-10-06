-- (a guest who makes an account: their ledger moves with them — the only change a ledger row may have, its
-- owner, and only when the move sets kr.ledger_move for its transaction; amounts, balances and reasons never)
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('kr.ledger_delete', true) = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND current_setting('kr.ledger_move', true) = 'on'
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ledger: rows are never changed or deleted (reverse one instead)' USING ERRCODE = 'insufficient_privilege';
END $$;
