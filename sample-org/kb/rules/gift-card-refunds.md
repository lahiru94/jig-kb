---
id: rule.gift-card-refunds
kind: BusinessRule
title: Gift card orders are refunded to a gift card
statement: Orders paid with a gift card are refunded to a new gift card.
part-of: [capability.returns]
owned-by: [role.finance]
depends-on: [process.gift-card-reconciliation]
enforcement:
  kb-layer: false
claims:
  - says: Orders paid with a gift card are refunded to a new gift card
    source: doc:sample-org/docs/policies/refund-policy.md#5
    confidence: stated
  - says: The system cannot refund to a gift card; staff do it by hand
    source: doc:sample-org/docs/process-notes/customer-service-handbook.md#gift-card-refunds-manual
    confidence: stated
---
