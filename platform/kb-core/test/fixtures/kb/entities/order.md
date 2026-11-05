---
id: entity.order
kind: DataEntity
title: Order
part-of: [component.order-service]
identity: [order_id]
fields:
  - name: order_id
    type: string
    required: true
  - name: total
    type: decimal
    min: 0
  - name: status
    type: enum
    values: [placed, shipped, delivered]
  - name: placed_at
    type: timestamp
---
