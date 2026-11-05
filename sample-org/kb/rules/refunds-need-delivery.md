---
id: rule.refunds-need-delivery
kind: BusinessRule
title: Only delivered orders can be refunded
statement: An order must have been delivered before it can be refunded.
part-of: [capability.returns]
owned-by: [role.head-of-cs]
implemented-by: [component.returns-service]
enforced-on: [action.issue-refund]
enforcement:
  kb-layer: true
  components: [component.returns-service]
claims:
  - says: Agents check the order has been delivered before refunding
    source: doc:sample-org/docs/process-notes/customer-service-handbook.md#handling-refund-requests
    confidence: stated
  - says: The returns service rejects refunds for orders that are not delivered
    source: code:sample-org/services/returns/src/main.ts#L51
    confidence: inferred
---
```cedar
@rule("rule.refunds-need-delivery")
@level("3")
@reason("The order has not been delivered yet.")
forbid (principal, action == Action::"action.issue-refund", resource)
when { context.order_status != "delivered" };
```
