---
id: derivation.is-partial
kind: Derivation
title: Is this a partial refund?
output-type: bool
inputs:
  - name: amount_cents
    type: int
  - name: order_total_cents
    type: int
---
```cel
amount_cents < order_total_cents
```
