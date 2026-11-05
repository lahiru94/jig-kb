---
id: rule.refund-approval-limit
kind: BusinessRule
title: Refund approval limit
statement: Refunds over $500 need a supervisor's approval.
part-of: [capability.returns]
owned-by: [role.head-of-cs]
governed-by: [constraint.eu-withdrawal-right]
decided-by: [decision.2024-refund-policy]
implemented-by: [component.returns-service]
enforced-on: [action.issue-refund]
enforcement:
  kb-layer: true
  components: [component.returns-service]
override-threshold:
  rate: 0.8
  window-days: 90
  min-samples: 10
claims:
  - says: Agents may approve refunds up to $500; larger refunds need a supervisor
    source: doc:sample-org/docs/policies/refund-policy.md#3
    confidence: stated
  - says: Refunds above 50000 cents wait for supervisor approval
    source: code:sample-org/services/returns/src/main.ts#L20
    confidence: inferred
  - says: Supervisors approve almost all refunds over $500
    source: doc:sample-org/docs/process-notes/customer-service-handbook.md#handling-refund-requests
    confidence: stated
---
## Why
Limits the cost of mistakes and fraud on large refunds.

```cedar
@rule("rule.refund-approval-limit")
@level("2")
@reason("Refunds over $500 need a supervisor's approval.")
forbid (principal, action == Action::"action.issue-refund", resource)
when { context.amount_cents > 50000 };
```
