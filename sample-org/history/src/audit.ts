import type { AuditLog } from "@jig/kb-ops";
import type { History } from "./generate";

const CLAWBACK_CUTOFF = "2025-01-01T00:00:00.000Z";
const LIMIT_REASON = "Refunds over $500 need a supervisor's approval.";

/**
 * Loads generated history into the jig audit log, as if every refund request had gone through the KB:
 * each request becomes an `act` call with its raw facts in the shape the sample KB's bindings return,
 * so replay simulation can re-evaluate it, plus an approval row for every held request.
 */
export function loadHistoryIntoAudit(history: History, audit: AuditLog): { calls: number; approvals: number } {
  let approvals = 0;
  for (const request of history.requests) {
    const { order, account } = request.raw_facts;
    const decision = {
      level: request.decision.level,
      reasons: request.held_by
        ? [{ source: request.held_by, kind: "rule", level: 2, reason: LIMIT_REASON, statement: LIMIT_REASON }]
        : [],
    };
    audit.recordCall({
      request_id: request.request_id,
      at: request.evaluated_at,
      principal: request.principal,
      via_agent: request.via_agent,
      operation: "act",
      target: request.action,
      inputs: { action: request.action, inputs: request.inputs },
      kb_version: "seed",
      raw_facts: {
        calls: [
          {
            binding: "binding.get-order",
            params: { order_id: order.order_id },
            response: { ...order, status: "delivered" },
          },
          { binding: "binding.get-loyalty-account", params: { customer_id: order.customer_id }, response: { customer_id: account.customer_id, tier: account.tier } },
          {
            binding: "binding.get-order-points",
            params: { order_id: order.order_id },
            response: { order_id: order.order_id, clawback_applies: order.placed_at >= CLAWBACK_CUTOFF },
          },
          { binding: "binding.count-order-refunds", params: { order_id: order.order_id }, response: { refund_count: 0, rows: [{ refund_count: 0 }] } },
        ],
      },
      context: { evaluated_at: request.evaluated_at },
      decision,
      outcome: request.decision.level === 2 ? "queued" : "executed",
      error: null,
    });
    if (request.approval) {
      approvals++;
      audit.recordApproval({
        request_id: request.request_id,
        at: request.approval.at,
        approver: request.approval.approved_by,
        approved: request.approval.approved,
        override: request.approval.approved,
        comment: null,
      });
      audit.recordOutcome({ request_id: request.request_id, at: request.approval.at, status: request.approval.approved ? "executed" : "rejected", steps: [] });
    }
  }
  return { calls: history.requests.length, approvals };
}
