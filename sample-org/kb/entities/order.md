---
id: entity.order
kind: DataEntity
title: Order
part-of: [component.orders-service]
identity: [order_id]
fields:
  - name: order_id
    type: string
    required: true
  - name: customer_id
    type: ref
    ref: entity.customer
  - name: status
    type: enum
    values: [placed, delivered, cancelled]
  - name: total_cents
    type: int
    min: 0
  - name: placed_at
    type: timestamp
  - name: delivered_at
    type: timestamp
---
