---
id: rule.cancellation-window
kind: BusinessRule
title: Agents cancel orders placed in the last 24 hours
statement: Customer service agents may cancel orders placed in the last 24 hours; older orders need a supervisor's approval.
part-of: [capability.ordering]
owned-by: [role.head-of-cs]
enforced-on: [action.cancel-order]
uses: [derivation.hours-since-placed]
enforcement:
  kb-layer: true
claims:
  - says: Agents may cancel orders placed in the last 24 hours; older orders need a supervisor
    source: doc:sample-org/docs/policies/cancellation-policy.md#2
    confidence: stated
---
```cedar
@rule("rule.cancellation-window")
@level("2")
@reason("Orders placed more than 24 hours ago need a supervisor's approval to cancel.")
forbid (principal, action == Action::"action.cancel-order", resource)
when { context.hours_since_placed > 24 };
```
