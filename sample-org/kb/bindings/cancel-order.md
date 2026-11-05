---
id: binding.cancel-order
kind: Binding
title: Cancel an order
binding-type: rest
binds-to: [component.orders-service]
config:
  service: orders
  method: POST
  path: /orders/{order_id}/cancel
---
