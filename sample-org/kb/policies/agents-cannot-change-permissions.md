---
id: policy.agents-cannot-change-permissions
kind: Policy
title: Changes to permissions always need a human
---
Documents the platform floor (design D8) in the KB, so it shows up in views and impact analysis.
The platform enforces it in code whatever this policy says.

```cedar
@level("2")
@reason("Changes to permissions or policies always need a human's approval.")
forbid (principal, action == Action::"kb.apply-delta", resource)
when { context has changes_guardrails && context.changes_guardrails };
```
