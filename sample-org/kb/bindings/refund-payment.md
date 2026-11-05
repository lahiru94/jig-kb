---
id: binding.refund-payment
kind: Binding
title: Refund a payment
binding-type: rest
binds-to: [component.payments-service]
config:
  service: payments
  method: POST
  path: /payments/{order_id}/refunds
  body:
    amount_cents: $input.amount_cents
    refund_id: $run.id
---
