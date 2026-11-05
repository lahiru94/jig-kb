---
id: binding.cancel-shipment
kind: Binding
title: Stop a shipment
binding-type: rest
binds-to: [component.warehouse-service]
config:
  service: warehouse
  method: POST
  path: /shipments/{order_id}/cancel
---
