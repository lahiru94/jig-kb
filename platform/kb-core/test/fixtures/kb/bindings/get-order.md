---
id: binding.get-order
kind: Binding
title: Read an order
binding-type: rest
binds-to: [component.order-service]
config:
  method: GET
  url: http://localhost:4100/orders/{order_id}
---
