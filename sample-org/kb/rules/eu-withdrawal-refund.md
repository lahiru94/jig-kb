---
id: rule.eu-withdrawal-refund
kind: BusinessRule
title: EU withdrawals are refunded within 14 days
statement: When an EU customer withdraws within 14 days of delivery, the refund must be issued within 14 days, and the approval limit must not delay it.
part-of: [capability.returns]
owned-by: [role.head-of-cs]
governed-by: [constraint.eu-withdrawal-right]
enforcement:
  kb-layer: false
claims:
  - says: EU withdrawals must be refunded within 14 days and cannot be refused because of the approval limit
    source: doc:sample-org/docs/policies/refund-policy.md#4
    confidence: stated
---
## Gap
Nothing enforces this rule: no service implements it, and the KB has no check for it yet.
Large EU refunds currently wait in the supervisor queue like any other.
