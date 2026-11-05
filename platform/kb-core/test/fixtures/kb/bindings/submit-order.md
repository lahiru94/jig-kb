---
id: binding.submit-order
kind: Binding
title: Submit an order
binding-type: sql
binds-to: [entity.order]
config:
  query: UPDATE orders SET status = 'placed' WHERE order_id = $1
  params: [order_id]
---
