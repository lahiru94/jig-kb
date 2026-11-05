---
id: rule.cancel-before-delivery
kind: BusinessRule
title: Only undelivered orders can be cancelled
statement: An order can be cancelled until it has been delivered.
part-of: [capability.ordering]
owned-by: [role.head-of-cs]
implemented-by: [component.orders-service]
enforced-on: [action.cancel-order]
enforcement:
  kb-layer: true
  components: [component.orders-service]
claims:
  - says: Orders can be cancelled until they are delivered
    source: doc:sample-org/docs/policies/cancellation-policy.md#1
    confidence: stated
  - says: The orders service only cancels orders whose status is placed
    source: code:sample-org/services/orders/src/main.ts#L102
    confidence: inferred
---
```cedar
@rule("rule.cancel-before-delivery")
@level("3")
@reason("Only orders that have not been delivered can be cancelled.")
forbid (principal, action == Action::"action.cancel-order", resource)
when { context.order_status != "placed" };
```
