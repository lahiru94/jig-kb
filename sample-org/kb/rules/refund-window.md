---
id: rule.refund-window
kind: BusinessRule
title: Refund window
statement: Customers may request a refund within 30 days of delivery.
part-of: [capability.returns]
owned-by: [role.head-of-cs]
governed-by: [constraint.eu-withdrawal-right]
decided-by: [decision.2024-refund-policy]
implemented-by: [component.returns-service]
enforced-on: [action.issue-refund]
uses: [derivation.days-since-delivery, derivation.refund-window-days]
enforcement:
  kb-layer: true
  components: [component.returns-service]
claims:
  - says: Refunds can be requested within 30 days of delivery, for all customers
    source: doc:sample-org/docs/policies/refund-policy.md#1
    confidence: stated
  - says: Gold members get 45 days, everyone else 30
    source: code:sample-org/services/returns/src/main.ts#L22-L23
    confidence: inferred
conflicts:
  - about: refund window for Gold members
    claims: [0, 1]
    status: open
---
## Why
Set in the 2024 policy review to limit late returns of used goods.

## Note
The KB layer currently mirrors the code (45 days for Gold) so that it does not change behavior
while the conflict with the policy is open.

```cedar
@rule("rule.refund-window")
@level("3")
@reason("The order is outside the refund window.")
forbid (principal, action == Action::"action.issue-refund", resource)
when { context.days_since_delivery > context.refund_window_days };
```
