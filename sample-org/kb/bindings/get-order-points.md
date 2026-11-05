---
id: binding.get-order-points
kind: Binding
title: Read an order's loyalty points
binding-type: rest
binds-to: [component.loyalty-service]
config:
  service: loyalty
  method: GET
  path: /orders/{order_id}/points
---
