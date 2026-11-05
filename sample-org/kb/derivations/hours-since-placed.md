---
id: derivation.hours-since-placed
kind: Derivation
title: Hours since the order was placed
output-type: int
inputs:
  - name: placed_at
    type: timestamp
  - name: evaluated_at
    type: timestamp
---
```cel
(evaluated_at - placed_at).getHours()
```
