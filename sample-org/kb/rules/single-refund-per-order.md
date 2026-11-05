---
id: rule.single-refund-per-order
kind: BusinessRule
title: The ERP records one refund per order
statement: The legacy ERP records at most one refund per order; a second refund on the same order overwrites the first.
part-of: [capability.returns]
owned-by: [role.finance]
implemented-by: [component.legacy-erp]
enforced-on: [action.issue-refund]
notifies: [component.legacy-erp]
enforcement:
  kb-layer: true
  components: [component.legacy-erp]
claims:
  - says: Refund postings are stored with INSERT OR REPLACE keyed by order id
    source: code:sample-org/legacy-erp/src/erp.ts#L17-L39
    confidence: inferred
---
## Impact
The nightly finance report overstates net revenue when an order has more than one refund.
The KB holds a second refund on the same order for a human, so Finance can adjust the ledger.

```cedar
@rule("rule.single-refund-per-order")
@level("2")
@reason("This order already has a refund; the ERP keeps only one refund per order, so Finance must adjust the ledger by hand.")
forbid (principal, action == Action::"action.issue-refund", resource)
when { context.prior_refund_count > 0 };
```
