-- Read-only preview of the first monthly credit period for every account that hasn't started
-- one yet: what each balance becomes when the plan-credit code next sees the account (on its
-- next request, or the daily cron). Mirrors startFirstPeriod in apps/api/src/lib/planCredits.ts:
--   kept      = purchases + admin grants (net), never more than the current balance
--   new total = kept + the plan's monthly allowance
--   replaced  = the rest of the current balance (signup / starting credits), recorded as promo_expiry
-- A paid subscription without an admin-granted plan is renewed by its payments instead, so it's
-- listed but unchanged. Changes nothing; run with:
--   psql "$DATABASE_URL" -f packages/db/scripts/preview-plan-credits.sql
with accounts as (
  select
    u.id, u.email, u.role, u.credit_balance,
    greatest(0, coalesce((select sum(l.amount) from credit_ledger l
      where l.user_id = u.id and l.reason in ('purchase', 'purchase_refund', 'admin_grant')), 0))::int as permanent,
    coalesce(op.slug, bp.slug, 'starter') as plan,
    case
      when e.override_plan_id is not null and (e.override_ends_at is null or e.override_ends_at > now()) then op.monthly_credits
      when bp.interval = 'none' or bp.id is null then coalesce(bp.monthly_credits, (select monthly_credits from billing_plans where slug = 'starter'))
      else null
    end as allowance
  from users u
  left join user_entitlements e on e.user_id = u.id
  left join billing_plans bp on bp.id = e.plan_id
  left join billing_plans op on op.id = e.override_plan_id
    and (e.override_ends_at is null or e.override_ends_at > now())
  where e.credit_period_start is null
)
select
  email, role, plan,
  credit_balance as balance_now,
  least(credit_balance, permanent) as kept,
  case when allowance is null then 0 else credit_balance - least(credit_balance, permanent) end as replaced,
  allowance as monthly_allowance,
  case when allowance is null then credit_balance else least(credit_balance, permanent) + allowance end as balance_after,
  case when allowance is null then credit_balance else least(credit_balance, permanent) + allowance end - credit_balance as change
from accounts
order by change, email;
