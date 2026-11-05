---
id: binding.count-order-refunds
kind: Binding
title: Count refunds already made on an order
binding-type: sql
binds-to: [entity.refund]
config:
  database: retail
  query: SELECT count(*)::int AS refund_count FROM payments.refunds WHERE order_id = $1
  params: [order_id]
---
