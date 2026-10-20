import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { BillingEntitlement, EntitlementRow } from "./billing.js";
import { getSettings, type AppSettingsRow } from "./settings.js";

/**
 * Free-allowance eligibility: whether an account may receive the Free plan's monthly credits.
 *
 * Registering is never refused, and nothing here touches paid plans, admin-granted plans,
 * purchases, beta credits or credits already granted: it only decides whether the next Free
 * period starts with its allowance (planCredits.ts asks freeAllowanceGate). The decision lives on
 * user_entitlements.free_allowance_status; every assessment and operator decision is kept in
 * free_allowance_assessments with the evidence behind it.
 *
 * The rules (version FREE_ALLOWANCE_RULES_VERSION) use only what the platform already holds —
 * the account's email and whether Clerk verified it — so no device or network data is collected.
 * Their scores are starting hypotheses to tune in observe mode, not measured accuracy:
 *
 *   email not verified                                          → verification_required
 *   same mailbox (normalizeEmail) as an account that already
 *   received monthly credits                                    +60
 *   disposable email domain                                     +40
 *   score ≥ 60 → review_required; ≥ 30 → verification_required; else approved, unless the day's
 *   automatic approvals (app_settings.free_allowance_daily_approvals) are used up → verification.
 *
 * "denied" is never automatic: only an operator sets it. An account is assessed when its first
 * Free period is due, again before each later one (once per period), and when new evidence
 * arrives (its email becomes verified). An operator's decision stands until they change it or its
 * approved-until date passes. Accounts from before migration 0041 were approved without rules and
 * stay approved until an operator asks for a reassessment.
 */
export const FREE_ALLOWANCE_RULES_VERSION = 1;

export type FreeAllowanceStatus = EntitlementRow["freeAllowanceStatus"];
export type FreeAllowanceMode = AppSettingsRow["freeAllowanceMode"];
export type FreeAllowanceOutcome = Exclude<FreeAllowanceStatus, "pending">;
type AssessmentKind = (typeof schema.freeAllowanceAssessments.$inferInsert)["kind"];

const VERIFY_AT = 30;
const REVIEW_AT = 60;
const EMAIL_HISTORY_POINTS = 60;
const DISPOSABLE_POINTS = 40;

/** Throwaway-inbox domains. A starting list; Clerk can also block these at sign-up. */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "20minutemail.com", "33mail.com", "burnermail.io", "discard.email", "dispostable.com",
  "emailondeck.com", "fakeinbox.com", "getnada.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamailblock.com", "grr.la", "inboxkitten.com", "mail.tm", "maildrop.cc", "mailinator.com", "mailinator.net",
  "mailnesia.com", "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email", "sharklasers.com", "spam4.me",
  "spamgourmet.com", "temp-mail.org", "tempmail.com", "tempmail.dev", "tempmailo.com", "tempr.email", "throwawaymail.com",
  "trashmail.com", "trashmail.de", "yopmail.com", "yopmail.fr", "yopmail.net",
]);

/**
 * One mailbox, however it's written: lowercase, any "+tag" dropped, and for Gmail the dots too
 * (googlemail.com is the same mailbox). Kept identical to the backfill in migration 0041.
 */
export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  const domain = lower.slice(at + 1);
  const local = lower.slice(0, at).split("+")[0]!;
  if (domain === "gmail.com" || domain === "googlemail.com") return `${local.replaceAll(".", "")}@gmail.com`;
  return `${local}@${domain}`;
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@").pop() ?? "";
}

/** The plan's monthly credits are the Free allowance: the Free base plan, with no admin-granted plan. */
export function isFreeAllowance(billing: BillingEntitlement): boolean {
  return billing.override === null && billing.basePlan.interval === "none";
}

export interface FreeAllowanceSignals {
  /** As Clerk last reported it; null when not yet known (no penalty). */
  emailVerified: boolean | null;
  emailDomain: string;
  disposableDomain: boolean;
  /** Other accounts on the same mailbox that already received monthly credits. */
  sameMailboxAccounts: number;
  approvalsToday: number;
  dailyApprovalLimit: number;
}

/** The rules themselves, without the database: an outcome, its score and the reasons for it. */
export function decideFreeAllowance(signals: FreeAllowanceSignals): { outcome: FreeAllowanceOutcome; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (signals.sameMailboxAccounts > 0) {
    score += EMAIL_HISTORY_POINTS;
    reasons.push(`Same mailbox as ${signals.sameMailboxAccounts} other account${signals.sameMailboxAccounts === 1 ? "" : "s"} that already received monthly credits`);
  }
  if (signals.disposableDomain) {
    score += DISPOSABLE_POINTS;
    reasons.push(`Disposable email domain (${signals.emailDomain})`);
  }
  let outcome: FreeAllowanceOutcome = score >= REVIEW_AT ? "review_required" : score >= VERIFY_AT ? "verification_required" : "approved";
  if (signals.emailVerified === false) {
    if (outcome === "approved") outcome = "verification_required";
    reasons.push("Email not verified yet");
  }
  if (outcome === "approved" && signals.approvalsToday >= signals.dailyApprovalLimit) {
    outcome = "verification_required";
    reasons.push(`Today's ${signals.dailyApprovalLimit} automatic approvals are used up`);
  }
  if (reasons.length === 0) reasons.push("No risk signals");
  return { outcome, score, reasons };
}

const UTC_DAY_START = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;

async function readSignals(db: Database, userId: string, settings: AppSettingsRow): Promise<FreeAllowanceSignals> {
  const [user] = await db
    .select({ email: schema.users.email, normalized: schema.users.emailNormalized, verified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);
  const mailbox = user.normalized ?? normalizeEmail(user.email);
  const result = await db.execute<{ same_mailbox: number; approvals_today: number }>(sql`
    select
      (select count(*)::int from users o
        where o.email_normalized = ${mailbox} and o.id <> ${userId}
          and exists (select 1 from credit_ledger l where l.user_id = o.id and l.reason = 'plan_grant')) as same_mailbox,
      (select count(*)::int from free_allowance_assessments a
        where a.kind = 'signup' and a.outcome = 'approved' and a.decided_by is null and a.created_at >= ${UTC_DAY_START}) as approvals_today
  `);
  const row = result.rows[0];
  const domain = emailDomain(user.email);
  return {
    emailVerified: user.verified,
    emailDomain: domain,
    disposableDomain: DISPOSABLE_DOMAINS.has(domain),
    sameMailboxAccounts: Number(row?.same_mailbox ?? 0),
    approvalsToday: Number(row?.approvals_today ?? 0),
    dailyApprovalLimit: settings.freeAllowanceDailyApprovals,
  };
}

/**
 * Runs the rules for an account and records the outcome. The status only changes while it's
 * still the one the caller read (an operator's decision made meanwhile is never overwritten);
 * returns the status in force afterwards.
 */
export async function assessFreeAllowance(db: Database, userId: string, current: EntitlementRow, kind: AssessmentKind, settings: AppSettingsRow, now = new Date()): Promise<FreeAllowanceStatus> {
  const signals = await readSignals(db, userId, settings);
  const { outcome, score, reasons } = decideFreeAllowance(signals);
  const reason = reasons.join("; ");
  const [updated] = await db.batch([
    db
      .update(schema.userEntitlements)
      .set({
        freeAllowanceStatus: outcome,
        freeAllowanceReason: reason,
        freeAllowanceDecidedAt: now,
        freeAllowanceDecidedBy: null,
        freeAllowanceRuleVersion: FREE_ALLOWANCE_RULES_VERSION,
        freeAllowanceAssessedAt: now,
        freeAllowanceApprovedUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.userEntitlements.userId, userId),
          eq(schema.userEntitlements.freeAllowanceStatus, current.freeAllowanceStatus),
          current.freeAllowanceDecidedAt
            ? eq(schema.userEntitlements.freeAllowanceDecidedAt, current.freeAllowanceDecidedAt)
            : isNull(schema.userEntitlements.freeAllowanceDecidedAt),
        ),
      )
      .returning({ status: schema.userEntitlements.freeAllowanceStatus }),
    db.insert(schema.freeAllowanceAssessments).values({
      userId, kind, outcome, mode: settings.freeAllowanceMode, score, ruleVersion: FREE_ALLOWANCE_RULES_VERSION,
      signals: { ...signals }, reason, createdAt: now,
    }),
  ]);
  if (updated[0]) return updated[0].status;
  const [fresh] = await db.select({ status: schema.userEntitlements.freeAllowanceStatus }).from(schema.userEntitlements).where(eq(schema.userEntitlements.userId, userId));
  return fresh?.status ?? current.freeAllowanceStatus;
}

/**
 * Why the rules should look at this account before the Free period starting at `periodStart`,
 * or null. Operators' decisions stand (until an approval's end date); accounts approved before
 * the rules existed stay approved; the rules' own decisions are revisited once per period.
 */
export function assessmentDue(entitlement: EntitlementRow, periodStart: Date, now = new Date()): AssessmentKind | null {
  const kind: AssessmentKind = entitlement.creditPeriodStart ? "renewal" : "signup";
  if (entitlement.freeAllowanceStatus === "pending") return kind;
  if (entitlement.freeAllowanceDecidedBy) {
    const until = entitlement.freeAllowanceApprovedUntil;
    return entitlement.freeAllowanceStatus === "approved" && until && until <= now ? "renewal" : null;
  }
  if (entitlement.freeAllowanceRuleVersion === null) return null;
  const assessed = entitlement.freeAllowanceAssessedAt;
  return !assessed || assessed < periodStart ? kind : null;
}

/**
 * Whether the Free period starting at `periodStart` may be granted its allowance. Called by
 * ensureCreditPeriod only once such a period is due, so normal requests pay nothing for it.
 *
 * off: always (the rules don't run). observe: always, but the rules run and are recorded.
 * enforce: only an approved account. paused: no account starts a Free period.
 * If the rules fail, the account is treated as approved unless it was already held, and the
 * failure is logged: the promotional budget, not this check, is the financial backstop.
 */
export async function freeAllowanceGate(db: Database, userId: string, billing: BillingEntitlement, periodStart: Date, now = new Date()): Promise<boolean> {
  const settings = await getSettings(db);
  const mode = settings.freeAllowanceMode;
  if (mode === "off") return true;
  if (mode === "paused") return false;
  let status = billing.entitlement.freeAllowanceStatus;
  const due = assessmentDue(billing.entitlement, periodStart, now);
  if (due) {
    try {
      status = await assessFreeAllowance(db, userId, billing.entitlement, due, settings, now);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "free_allowance.assessment_failed", userId, error: error instanceof Error ? error.message : String(error) }));
      if (status === "pending") status = "approved";
    }
  }
  return mode === "observe" || status === "approved";
}

/**
 * New evidence: Clerk now reports the email verified. An account the rules held only for want of
 * that is assessed again straight away (an operator's decision is left alone). Returns true when
 * the status changed, so the caller can start a credit period that's now allowed.
 */
export async function reassessOnVerifiedEmail(db: Database, userId: string, entitlement: EntitlementRow, now = new Date()): Promise<boolean> {
  if (entitlement.freeAllowanceStatus !== "verification_required" || entitlement.freeAllowanceDecidedBy) return false;
  const settings = await getSettings(db);
  if (settings.freeAllowanceMode === "off") return false;
  const status = await assessFreeAllowance(db, userId, entitlement, "evidence", settings, now);
  return status !== entitlement.freeAllowanceStatus;
}

/** What /me reports: the status, and whether it is withholding this account's Free allowance now. */
export function freeCreditsStatus(billing: BillingEntitlement, mode: FreeAllowanceMode): { status: FreeAllowanceStatus; held: boolean } {
  const status = billing.entitlement.freeAllowanceStatus;
  const free = isFreeAllowance(billing);
  const held = free && (mode === "paused" || (mode === "enforce" && status !== "approved" && status !== "pending"));
  return { status, held };
}
