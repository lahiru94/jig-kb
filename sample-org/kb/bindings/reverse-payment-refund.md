---
id: binding.reverse-payment-refund
kind: Binding
title: Reverse a payment refund
binding-type: rest
binds-to: [component.payments-service]
config:
  service: payments
  method: POST
  path: /payments/{order_id}/refunds/{refund_id}/reverse
---
