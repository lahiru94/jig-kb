---
id: entity.loyalty-account
kind: DataEntity
title: Loyalty account
part-of: [component.loyalty-service]
identity: [customer_id]
fields:
  - name: customer_id
    type: ref
    ref: entity.customer
    required: true
  - name: tier
    type: enum
    values: [standard, gold]
  - name: points
    type: int
---
