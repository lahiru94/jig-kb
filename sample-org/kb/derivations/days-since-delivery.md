---
id: derivation.days-since-delivery
kind: Derivation
title: Days since delivery
output-type: int
inputs:
  - name: delivered_at
    type: timestamp
  - name: evaluated_at
    type: timestamp
---
```cel
(evaluated_at - delivered_at).getHours() / 24
```
