---
id: binding.cancel-submission
kind: Binding
title: Undo an order submission
binding-type: sql
binds-to: [entity.order]
config:
  query: UPDATE orders SET status = 'draft' WHERE order_id = $1
  params: [order_id]
---
