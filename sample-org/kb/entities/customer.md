---
id: entity.customer
kind: DataEntity
title: Customer
part-of: [component.orders-service]
identity: [customer_id]
fields:
  - name: customer_id
    type: string
    required: true
  - name: region
    type: enum
    values: [us, eu]
  - name: last_login_at
    type: timestamp
---
