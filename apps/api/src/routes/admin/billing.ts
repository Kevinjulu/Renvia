import { Hono } from "hono";
import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminBillingResponse, AdminFinancialsResponse, AdminOperationsQueueResponse, UserRole } from "@renvia/types";
import { getSettings, effectiveBudgetUsd } from "../../lib/settings.js";
import { paypalReady, paypalRequest } from "../../lib/paypal.js";
import { assertPaypalPurchaseRefundable, reversePaypalPurchaseCredits } from "../../lib/paypalSettlement.js";
import { resolveIncidentsForSource } from "../../lib/incidents.js";
import { replayVerifiedPaypalEvent } from "../webhooks/paypal.js";
import { hasPermission, denyUnless } from "./permissions.js";
import { MICROS_PER_USD, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const billingRoutes = new Hono<AdminContext>();

billingRoutes.get("/billing", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const [plans, payments, webhooks, [totals]] = await Promise.all([
    db
      .select({ id: schema.billingPlans.id, name: schema.billingPlans.name, slug: schema.billingPlans.slug, priceCents: schema.billingPlans.priceCents, currency: schema.billingPlans.currency, active: schema.billingPlans.isActive, subscribers: sql<number>`count(${schema.userEntitlements.id})::int` })
      .from(schema.billingPlans)
      .leftJoin(schema.userEntitlements, and(eq(schema.userEntitlements.planId, schema.billingPlans.id), eq(schema.userEntitlements.status, "active")))
      .groupBy(schema.billingPlans.id)
      .orderBy(asc(schema.billingPlans.priceCents)),
    db
      .select({ id: schema.billingPayments.id, userId: schema.billingPayments.userId, userEmail: schema.users.email, provider: schema.billingPayments.provider, providerPaymentId: schema.billingPayments.providerPaymentId, status: schema.billingPayments.status, amountCents: schema.billingPayments.amountCents, currency: schema.billingPayments.currency, createdAt: schema.billingPayments.createdAt, paidAt: schema.billingPayments.paidAt })
      .from(schema.billingPayments).innerJoin(schema.users, eq(schema.billingPayments.userId, schema.users.id)).orderBy(desc(schema.billingPayments.createdAt)).limit(30),
    db
      .select({ id: schema.billingWebhookEvents.id, provider: schema.billingWebhookEvents.provider, eventType: schema.billingWebhookEvents.eventType, processedAt: schema.billingWebhookEvents.processedAt, failedAt: schema.billingWebhookEvents.failedAt, attempts: schema.billingWebhookEvents.attempts, failureMessage: schema.billingWebhookEvents.failureMessage, createdAt: schema.billingWebhookEvents.createdAt })
      .from(schema.billingWebhookEvents).orderBy(desc(schema.billingWebhookEvents.createdAt)).limit(30),
    db.select({ paid: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'paid'), 0)::int`, refunded: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'refunded'), 0)::int` }).from(schema.billingPayments),
  ]);
  const response: AdminBillingResponse = {
    summary: {
      paidUsd: (totals?.paid ?? 0) / 100,
      refundedUsd: (totals?.refunded ?? 0) / 100,
      pendingWebhooks: webhooks.filter((event) => !event.processedAt && !event.failedAt).length,
      failedWebhooks: webhooks.filter((event) => Boolean(event.failedAt)).length,
    },
    plans: plans.map((plan) => ({ ...plan, active: plan.active })),
    payments: payments.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null })),
    webhooks: webhooks.map((event) => ({ id: event.id, provider: event.provider, eventType: event.eventType, status: event.processedAt ? "processed" : event.failedAt ? "failed" : "pending", attempts: event.attempts, failureMessage: event.failureMessage, createdAt: event.createdAt.toISOString() })),
  };
  return c.json(response);
});

/** Financial truth: captured provider money is separated from internally tracked FAL estimates. */
billingRoutes.get("/financials", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db"); const settings = await getSettings(db);
  const [payments, costs, models, customerRevenue, customerCosts, products, entitlements, [allTimeSpend]] = await Promise.all([
    db.select({ userId: schema.billingPayments.userId, amount: schema.billingPayments.amountCents, status: schema.billingPayments.status, createdAt: schema.billingPayments.createdAt, checkoutId: schema.billingPayments.checkoutId }).from(schema.billingPayments).where(gte(schema.billingPayments.createdAt, sql`now() - interval '30 days'`)),
    db.select({ day: sql<string>`to_char(date_trunc('day', ${schema.renders.createdAt}), 'YYYY-MM-DD')`, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint` }).from(schema.renders).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(sql`date_trunc('day', ${schema.renders.createdAt})`).orderBy(asc(sql`date_trunc('day', ${schema.renders.createdAt})`)),
    db.select({ label: schema.renders.model, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`, renders: sql<number>`count(*)::int` }).from(schema.renders).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(schema.renders.model).orderBy(desc(sql`sum(${schema.renders.costMicros})`)),
    db.select({ userId: schema.users.id, email: schema.users.email, revenue: sql<number>`coalesce(sum(${schema.billingPayments.amountCents}) filter (where ${schema.billingPayments.status} = 'paid'),0)::int` }).from(schema.users).leftJoin(schema.billingPayments, eq(schema.billingPayments.userId, schema.users.id)).groupBy(schema.users.id, schema.users.email),
    db.select({ userId: schema.projects.ownerId, cost: sql<number>`coalesce(sum(${schema.renders.costMicros}),0)::bigint` }).from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(and(gte(schema.renders.createdAt, sql`now() - interval '30 days'`), ne(schema.renders.status, "failed"))).groupBy(schema.projects.ownerId),
    db.select({ amount: schema.billingPayments.amountCents, status: schema.billingPayments.status, plan: schema.billingPlans.name, pack: schema.creditPacks.name }).from(schema.billingPayments).leftJoin(schema.billingCheckouts, eq(schema.billingPayments.checkoutId, schema.billingCheckouts.id)).leftJoin(schema.billingPlans, eq(schema.billingCheckouts.planId, schema.billingPlans.id)).leftJoin(schema.creditPacks, eq(schema.billingCheckouts.creditPackId, schema.creditPacks.id)).where(gte(schema.billingPayments.createdAt, sql`now() - interval '30 days'`)),
    db.select({ price: schema.billingPlans.priceCents, status: schema.userEntitlements.status }).from(schema.userEntitlements).innerJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id)),
    db.select({ spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}) filter (where ${schema.renders.status} <> 'failed'),0)::bigint` }).from(schema.renders),
  ]);
  const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amount, 0) / 100;
  const refunded = payments.filter((payment) => payment.status === "refunded").reduce((sum, payment) => sum + payment.amount, 0) / 100;
  // Neon/Postgres returns bigint aggregates as strings. Convert before arithmetic:
  // adding them directly concatenates digits and produces fictional financial totals.
  const micros = (value: number | string | null | undefined) => Number(value ?? 0);
  const estimatedCost = costs.reduce((sum, row) => sum + micros(row.cost), 0) / MICROS_PER_USD;
  const dailyBurnUsd = costs.filter((row) => row.day >= new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)).reduce((sum, row) => sum + micros(row.cost), 0) / MICROS_PER_USD / 7;
  const budget = effectiveBudgetUsd(c.env, settings);
  const dailyPayments = new Map<string, { revenueUsd: number; refundsUsd: number; failedPayments: number }>();
  for (const payment of payments) {
    const day = payment.createdAt.toISOString().slice(0, 10); const current = dailyPayments.get(day) ?? { revenueUsd: 0, refundsUsd: 0, failedPayments: 0 };
    if (payment.status === "paid") current.revenueUsd += payment.amount / 100;
    if (payment.status === "refunded") current.refundsUsd += payment.amount / 100;
    if (payment.status === "failed") current.failedPayments += 1;
    dailyPayments.set(day, current);
  }
  const byProduct = (key: "plan" | "pack") => Object.entries(products.reduce<Record<string, number>>((all, item) => { const label = item[key] ?? "Unattributed"; if (item.status === "paid") all[label] = (all[label] ?? 0) + item.amount / 100; return all; }, {})).map(([label, revenueUsd]) => ({ label, revenueUsd, estimatedCostUsd: 0, marginUsd: revenueUsd }));
  const costByCustomer = new Map(customerCosts.map((row) => [row.userId, micros(row.cost) / MICROS_PER_USD]));
  const response: AdminFinancialsResponse = {
    revenue: { capturedUsd: paid, refundedUsd: refunded, netUsd: paid - refunded, mrrUsd: entitlements.filter((item) => item.status === "active").reduce((sum, item) => sum + item.price / 100, 0), failedPayments: payments.filter((payment) => payment.status === "failed").length, conversionRate: payments.length ? payments.filter((payment) => payment.status === "paid").length / payments.length : 0, churnedSubscribers: entitlements.filter((item) => item.status === "canceled" || item.status === "expired").length },
    estimatedCost: { falUsd: estimatedCost, dailyBurnUsd, trackedBudgetUsd: budget, projectedBudgetExhaustion: budget !== null && dailyBurnUsd > 0 ? new Date(Date.now() + Math.max(0, budget - (micros(allTimeSpend?.spentMicros) / MICROS_PER_USD)) / dailyBurnUsd * 86_400_000).toISOString() : null, reconciliationStatus: "not_connected" },
    margins: { byPlan: byProduct("plan"), byPack: byProduct("pack"), byModel: models.map((row) => ({ label: row.label ?? "Unknown model", estimatedCostUsd: micros(row.cost) / MICROS_PER_USD, renders: row.renders })), byCustomer: customerRevenue.map((row) => ({ userId: row.userId, email: row.email, revenueUsd: row.revenue / 100, estimatedCostUsd: costByCustomer.get(row.userId) ?? 0, marginUsd: row.revenue / 100 - (costByCustomer.get(row.userId) ?? 0) })).sort((a, b) => b.revenueUsd - a.revenueUsd).slice(0, 50) },
    daily: [...new Set([...costs.map((row) => row.day), ...dailyPayments.keys()])].sort().map((day) => { const cost = micros(costs.find((row) => row.day === day)?.cost); const money = dailyPayments.get(day) ?? { revenueUsd: 0, refundsUsd: 0, failedPayments: 0 }; return { day, estimatedCostUsd: cost / MICROS_PER_USD, ...money }; }),
  };
  return c.json(response);
});

/** Compact, role-filtered queue for the operator currently signed in. */
billingRoutes.get("/operations/queue", async (c) => {
  const db = c.get("db"); const actor = c.get("admin");
  const [incidents, approvals, renders, segmentations] = await Promise.all([
    hasPermission(actor.role as UserRole, "incidents.read") ? db.select({ id: schema.incidents.id, title: schema.incidents.title, severity: schema.incidents.severity, status: schema.incidents.status, updatedAt: schema.incidents.updatedAt }).from(schema.incidents).where(and(eq(schema.incidents.ownerId, actor.id), ne(schema.incidents.status, "resolved"))).orderBy(desc(schema.incidents.updatedAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "settings.read") ? db.select({ id: schema.approvalRequests.id, action: schema.approvalRequests.action, reason: schema.approvalRequests.reason, requestedBy: schema.users.email, createdAt: schema.approvalRequests.createdAt }).from(schema.approvalRequests).innerJoin(schema.users, eq(schema.approvalRequests.requestedBy, schema.users.id)).where(eq(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.createdAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "renders.read") ? db.select({ id: schema.renders.id, label: schema.projects.name, userId: schema.projects.ownerId, createdAt: schema.renders.updatedAt }).from(schema.renders).innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id)).where(eq(schema.renders.status, "failed")).orderBy(desc(schema.renders.updatedAt)).limit(20) : Promise.resolve([]),
    hasPermission(actor.role as UserRole, "segmentations.read") ? db.select({ id: schema.segmentations.id, userId: schema.segmentations.userId, createdAt: schema.segmentations.createdAt }).from(schema.segmentations).where(eq(schema.segmentations.status, "failed")).orderBy(desc(schema.segmentations.createdAt)).limit(20) : Promise.resolve([]),
  ]);
  const response: AdminOperationsQueueResponse = { assignedIncidents: incidents.map((row) => ({ ...row, severity: row.severity as AdminOperationsQueueResponse["assignedIncidents"][number]["severity"], status: row.status as AdminOperationsQueueResponse["assignedIncidents"][number]["status"], updatedAt: row.updatedAt.toISOString() })), pendingApprovals: approvals.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), failedJobs: [...renders.map((row) => ({ ...row, type: "render" as const, createdAt: row.createdAt.toISOString() })), ...segmentations.map((row) => ({ ...row, label: "Selection", type: "segmentation" as const, createdAt: row.createdAt.toISOString() }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20) };
  return c.json(response);
});

/**
 * A refund is deliberately blocked once its purchased credits have been spent. This
 * avoids a money refund while retaining consumed Renvia service; those cases need a
 * documented manual support decision instead of an unsafe automatic reversal.
 */
billingRoutes.post("/billing/payments/:id/refund", async (c) => {
  const denied = denyUnless(c, "billing.manage"); if (denied) return c.json(denied, 403);
  if (!paypalReady(c.env)) return c.json({ error: "PayPal refunds are not configured" }, 503);
  const db = c.get("db");
  const paymentId = z.string().uuid().parse(c.req.param("id"));
  const [payment] = await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.id, paymentId)).limit(1);
  if (!payment) return c.json({ error: "Payment not found" }, 404);
  if (payment.provider !== "paypal" || payment.status !== "paid") return c.json({ error: "Only captured PayPal payments can be refunded" }, 409);
  try {
    await assertPaypalPurchaseRefundable(db, payment.id);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Payment is not refundable", code: "refund_manual_review" }, 409);
  }
  try {
    const response = await paypalRequest<{ id?: string }>(c.env, `/v2/payments/captures/${payment.providerPaymentId}/refund`, { method: "POST", headers: { "PayPal-Request-Id": `refund-${payment.id}` }, body: JSON.stringify({}) });
    if (!response.id) throw new Error("PayPal did not return a refund ID");
    await reversePaypalPurchaseCredits(db, payment.id, response.id);
    await db.update(schema.billingPayments).set({ status: "refunded", updatedAt: new Date(), providerMetadata: { ...(payment.providerMetadata ?? {}), refundId: response.id } }).where(eq(schema.billingPayments.id, payment.id));
    await recordAdminEvent(db, { actorId: c.get("admin").id, action: "billing.payment", targetType: "billing_payment", targetId: payment.id, summary: `Refunded PayPal payment ${payment.providerPaymentId}`, detail: { refundId: response.id, amountCents: payment.amountCents, currency: payment.currency } });
    return c.json({ id: payment.id, status: "refunded" });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not refund payment" }, 502);
  }
});

/** Replays only a previously signature-verified stored PayPal event. */
billingRoutes.post("/billing/webhooks/:id/replay", async (c) => {
  const denied = denyUnless(c, "billing.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [event] = await db.select().from(schema.billingWebhookEvents).where(eq(schema.billingWebhookEvents.id, id)).limit(1);
  if (!event) return c.json({ error: "Webhook event not found" }, 404);
  if (event.provider !== "paypal" || event.verificationStatus !== "verified") return c.json({ error: "Only previously verified PayPal events can be replayed" }, 409);
  try {
    await replayVerifiedPaypalEvent(db, event.payload);
    await db.update(schema.billingWebhookEvents).set({ processedAt: new Date(), failedAt: null, failureMessage: null, attempts: sql`${schema.billingWebhookEvents.attempts} + 1`, lastAttemptAt: new Date() }).where(eq(schema.billingWebhookEvents.id, event.id));
    await resolveIncidentsForSource(db, "webhook", event.id, c.get("admin").id, "Verified webhook replay completed successfully");
    await recordAdminEvent(db, { actorId: c.get("admin").id, action: "billing.webhook", targetType: "billing_webhook", targetId: event.id, summary: `Replayed PayPal event ${event.eventType}`, detail: { providerEventId: event.providerEventId } });
    return c.json({ id: event.id, status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Webhook replay failed";
    await db.update(schema.billingWebhookEvents).set({ failedAt: new Date(), failureMessage: message, attempts: sql`${schema.billingWebhookEvents.attempts} + 1`, lastAttemptAt: new Date() }).where(eq(schema.billingWebhookEvents.id, event.id));
    return c.json({ error: message }, 502);
  }
});
