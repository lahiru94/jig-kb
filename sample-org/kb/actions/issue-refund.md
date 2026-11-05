---
id: action.issue-refund
kind: Action
title: Issue a refund
description: Refund all or part of a delivered order to the original payment method.
mode: connected
part-of: [capability.returns]
resource: entity.order
notifies: [interface.refund-email]
inputs:
  - name: order_id
    type: string
    required: true
  - name: amount_cents
    type: int
    required: true
    min: 1
facts:
  - name: order_status
    type: string
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: status
  - name: order_total_cents
    type: int
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: total_cents
  - name: customer_id
    type: string
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: customer_id
  - name: delivered_at
    type: timestamp
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: delivered_at
  - name: customer_tier
    type: string
    binding: binding.get-loyalty-account
    with: {customer_id: $fact.customer_id}
    path: tier
  - name: clawback_applies
    type: bool
    binding: binding.get-order-points
    with: {order_id: $input.order_id}
    path: clawback_applies
  - name: prior_refund_count
    type: int
    binding: binding.count-order-refunds
    with: {order_id: $input.order_id}
    path: refund_count
  - name: days_since_delivery
    type: int
    derivation: derivation.days-since-delivery
    with: {delivered_at: $fact.delivered_at, evaluated_at: $context.evaluated_at}
  - name: refund_window_days
    type: int
    derivation: derivation.refund-window-days
    with: {customer_tier: $fact.customer_tier}
  - name: is_partial
    type: bool
    derivation: derivation.is-partial
    with: {amount_cents: $input.amount_cents, order_total_cents: $fact.order_total_cents}
steps:
  - name: refund-payment
    kind: binding-call
    binding: binding.refund-payment
    with: {order_id: $input.order_id, amount_cents: $input.amount_cents}
    compensate:
      binding: binding.reverse-payment-refund
      with: {order_id: $input.order_id, refund_id: $step.refund-payment.refund_id}
  - name: clawback-points
    kind: binding-call
    binding: binding.clawback-points
    with: {order_id: $input.order_id}
    compensate:
      binding: binding.reverse-clawback
      with: {order_id: $input.order_id}
  - name: post-to-erp
    kind: binding-call
    binding: binding.post-erp-refund
    with: {order_id: $input.order_id, amount_cents: $input.amount_cents}
  - name: notify-customer
    kind: binding-call
    binding: binding.send-refund-email
    with: {order_id: $input.order_id, customer_id: $fact.customer_id}
---
Runs the refund across the systems directly: payments, loyalty, the ERP and notifications.
The KB checks every rule enforced on this action before any step runs.
