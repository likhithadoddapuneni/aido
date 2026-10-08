-- Viewing attendance, outcome time and deposit credit.
--
-- A viewing can span several showrooms, so attendance is recorded per stop (checked in by QR scan,
-- then marked Attended or No-show by that showroom). The request's outcome time starts the deposit's
-- seven-day credit window; the credited amount records how much of a deposit an order consumed.

ALTER TABLE viewing.viewing_stop
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN attendance    text,
  ADD COLUMN attendance_at timestamptz,
  ADD CONSTRAINT viewing_stop_attendance_enum CHECK (attendance IN ('Attended', 'No-show')),
  ADD CONSTRAINT viewing_stop_attendance_ck CHECK (
    (attendance IS NULL) = (attendance_at IS NULL)
    AND (attendance IS DISTINCT FROM 'Attended' OR checked_in_at IS NOT NULL));

ALTER TABLE viewing.viewing_request
  ADD COLUMN outcome_at timestamptz;

ALTER TABLE viewing.viewing_deposit
  ADD COLUMN credited_fils bigint,
  ADD CONSTRAINT viewing_deposit_credited_ck CHECK (
    credited_fils IS NULL OR (credited_fils > 0 AND credited_fils <= amount_fils));
