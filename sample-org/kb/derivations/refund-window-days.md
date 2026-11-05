---
id: derivation.refund-window-days
kind: Derivation
title: Refund window in days for the customer's tier
output-type: int
inputs:
  - name: customer_tier
    type: string
---
Mirrors the returns service: 45 days for Gold, 30 otherwise.

```cel
customer_tier == "gold" ? 45 : 30
```
