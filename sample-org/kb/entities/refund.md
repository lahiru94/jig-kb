---
id: entity.refund
kind: DataEntity
title: Refund
part-of: [component.payments-service]
identity: [refund_id]
fields:
  - name: refund_id
    type: string
    required: true
  - name: order_id
    type: ref
    ref: entity.order
  - name: amount_cents
    type: int
    min: 1
---
