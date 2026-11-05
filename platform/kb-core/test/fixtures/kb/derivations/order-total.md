---
id: derivation.order-total
kind: Derivation
title: Order total with tax
output-type: decimal
inputs:
  - name: subtotal
    type: decimal
  - name: tax
    type: decimal
---
```cel
subtotal + tax
```
