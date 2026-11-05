---
id: binding.uncancel-order
kind: Binding
title: Undo an order cancellation
binding-type: rest
binds-to: [component.orders-service]
config:
  service: orders
  method: POST
  path: /orders/{order_id}/uncancel
---
