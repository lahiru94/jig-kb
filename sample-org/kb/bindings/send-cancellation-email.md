---
id: binding.send-cancellation-email
kind: Binding
title: Send the cancellation email
binding-type: rest
binds-to: [component.notifications-service]
config:
  service: notifications
  method: POST
  path: /notify
  body:
    customer_id: $fact.customer_id
    template: order_cancelled
    vars: {order_id: $input.order_id}
---
