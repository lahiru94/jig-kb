---
id: binding.post-erp-refund
kind: Binding
title: Post a refund to the ERP
binding-type: rest
binds-to: [interface.erp-postings]
config:
  service: legacy-erp
  method: POST
  path: /postings
  body:
    order_id: $input.order_id
    kind: refund
    amount_cents: $input.amount_cents
    at: $context.evaluated_at
---
