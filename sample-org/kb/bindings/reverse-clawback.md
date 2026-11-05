---
id: binding.reverse-clawback
kind: Binding
title: Restore clawed-back points
binding-type: rest
binds-to: [component.loyalty-service]
config:
  service: loyalty
  method: POST
  path: /clawback/reverse
  body:
    order_id: $input.order_id
---
