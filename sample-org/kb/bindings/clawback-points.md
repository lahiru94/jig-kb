---
id: binding.clawback-points
kind: Binding
title: Claw back an order's loyalty points
binding-type: rest
binds-to: [component.loyalty-service]
config:
  service: loyalty
  method: POST
  path: /clawback
  body:
    order_id: $input.order_id
---
