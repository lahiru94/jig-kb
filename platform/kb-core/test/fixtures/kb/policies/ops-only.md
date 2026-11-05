---
id: policy.ops-only
kind: Policy
title: Only operations staff place orders
enforced-on: [action.place-order]
---
```cedar
@level("3")
@reason("Only operations staff may place orders.")
forbid (principal, action == Action::"action.place-order", resource)
unless { principal in Role::"role.ops-lead" };
```
