---
id: binding.get-order
kind: Binding
title: Read an order
binding-type: rest
binds-to: [component.orders-service]
config:
  service: orders
  method: GET
  path: /orders/{order_id}
---
