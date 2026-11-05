---
id: binding.get-loyalty-account
kind: Binding
title: Read a loyalty account
binding-type: rest
binds-to: [component.loyalty-service]
config:
  service: loyalty
  method: GET
  path: /accounts/{customer_id}
---
