import type { CreditLedgerReason } from "@renvia/types";

/** Display labels for ledger reasons. Unknown reasons fall back to the raw key. */
export const CREDIT_REASON_LABELS: Partial<Record<CreditLedgerReason, string>> = {
  signup_bonus: "Signup bonus",
  initial_grant: "Initial grant",
  admin_grant: "Admin adjustment",
  render: "Render",
  render_refund: "Refund (render)",
  segment: "Segmentation",
  segment_refund: "Refund (segmentation)",
  purchase: "Purchase",
};

export function formatCreditReason(reason: CreditLedgerReason): string {
  return CREDIT_REASON_LABELS[reason] ?? reason;
}
