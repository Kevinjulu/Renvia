-- One-off repair for accounts that kept a granted plan's credits after the plan was removed
-- (bug fixed in apps/api/src/lib/planCredits.ts: revokeOverrideCredits). Mirrors that function:
-- the part of the period's allowance that came from the granted plan (and is unspent) leaves the
-- balance and is recorded as plan_expiry, and the period high-water mark returns to the base
-- allowance so granting a plan again tops up properly. Purchased, admin and beta credits stay.
--
-- Step 1 (read-only): list every affected account.
--   select u.email, u.credit_balance, u.plan_credits, p.monthly_credits as base_allowance, e.period_credits_granted
--   from users u join user_entitlements e on e.user_id = u.id join billing_plans p on p.id = e.plan_id
--   where e.override_plan_id is null and e.period_credits_granted > p.monthly_credits and u.plan_credits > 0;
--
-- Step 2: repair one account. Change the email, run in a single transaction.
begin;
with target as (
  select u.id, least(u.plan_credits, greatest(0, e.period_credits_granted - p.monthly_credits)) as removed, p.monthly_credits as base
  from users u join user_entitlements e on e.user_id = u.id join billing_plans p on p.id = e.plan_id
  where u.email = 'ramahstudiointernational@gmail.com' and e.override_plan_id is null and e.period_credits_granted > p.monthly_credits and u.plan_credits > 0
  for update of u
),
fixed as (
  update users u
  set last_plan_debit = t.removed,
      credit_balance = u.credit_balance - t.removed,
      plan_credits = u.plan_credits - t.removed,
      updated_at = now()
  from target t where u.id = t.id
  returning u.id, t.removed
),
entitlement as (
  update user_entitlements e
  set period_credits_granted = t.base, last_topup = 0, updated_at = now()
  from target t where e.user_id = t.id
  returning e.user_id
)
insert into credit_ledger (user_id, amount, plan_amount, reason, note)
select id, -removed, -removed, 'plan_expiry', 'Granted plan removed (repair)' from fixed;
-- Check, then commit (or rollback):
select email, credit_balance, plan_credits, beta_credits from users where email = 'ramahstudiointernational@gmail.com';
-- commit;
