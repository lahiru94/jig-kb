---
id: binding.send-refund-email
kind: Binding
title: Send the refund email
binding-type: rest
binds-to: [interface.refund-email]
config:
  service: notifications
  method: POST
  path: /notify
  body:
    customer_id: $fact.customer_id
    template: refund_completed
    vars: {order_id: $input.order_id}
---
