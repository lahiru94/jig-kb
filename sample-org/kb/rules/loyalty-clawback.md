---
id: rule.loyalty-clawback
kind: BusinessRule
title: Loyalty points clawback on refunds
statement: Refunding an order placed on or after 1 January 2025 claws back all the loyalty points the order earned, even when the refund is partial.
part-of: [capability.loyalty]
owned-by: [role.marketing]
implemented-by: [component.loyalty-service]
enforced-on: [action.issue-refund]
uses: [derivation.is-partial]
enforcement:
  kb-layer: true
  components: [component.loyalty-service]
claims:
  - says: Refunds claw back points only for orders placed on or after 2025-01-01
    source: code:sample-org/services/loyalty/src/main.ts#L22
    confidence: inferred
  - says: A clawback removes every point the order earned, whatever the refund amount
    source: code:sample-org/services/loyalty/src/main.ts#L71
    confidence: inferred
---
## Why
Unknown. This rule is not in the loyalty programme terms and was found only in code.

## Risk
A partial refund on a recent order takes away all of the customer's points for that order.
The KB holds partial refunds on such orders for a human, who can adjust the points.

```cedar
@rule("rule.loyalty-clawback")
@level("2")
@reason("This partial refund would claw back all the order's loyalty points; a human must check the points adjustment.")
forbid (principal, action == Action::"action.issue-refund", resource)
when { context.is_partial && context.clawback_applies };
```
