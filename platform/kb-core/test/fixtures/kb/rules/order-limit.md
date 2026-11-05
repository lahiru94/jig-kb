---
id: rule.order-limit
kind: BusinessRule
title: Order limit
statement: Orders above 1000 need manager approval.
part-of: [capability.ordering]
implemented-by: [component.order-service]
enforced-on: [action.place-order]
uses: [derivation.order-total]
governed-by: [constraint.consumer-law]
decided-by: [decision.2024-order-limit]
owned-by: [role.ops-lead]
enforcement:
  kb-layer: true
  components: [component.order-service]
override-threshold:
  rate: 0.8
  window-days: 7
  min-samples: 10
claims:
  - says: Orders above 1000 need approval
    source: doc:policies/ordering.md#limits
    confidence: stated
  - says: Orders above 1500 need approval
    source: code:order-service/src/limits.ts#L10-L14
    confidence: inferred
conflicts:
  - about: approval threshold
    claims: [0, 1]
    status: open
---
## Why
Large orders carry fraud risk.

```cedar
@rule("rule.order-limit")
@level("2")
@reason("Orders above 1000 need manager approval.")
forbid (principal, action == Action::"action.place-order", resource)
when { context.order_total > 1000 };
```
