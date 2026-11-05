---
id: action.cancel-order
kind: Action
title: Cancel an order
description: Cancel an order that has not been delivered, stop its shipment and tell the customer.
mode: connected
part-of: [capability.ordering]
resource: entity.order
inputs:
  - name: order_id
    type: string
    required: true
facts:
  - name: order_status
    type: string
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: status
  - name: customer_id
    type: string
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: customer_id
  - name: placed_at
    type: timestamp
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: placed_at
  - name: hours_since_placed
    type: int
    derivation: derivation.hours-since-placed
    with: {placed_at: $fact.placed_at, evaluated_at: $context.evaluated_at}
steps:
  - name: cancel-order
    kind: binding-call
    binding: binding.cancel-order
    with: {order_id: $input.order_id}
    compensate:
      binding: binding.uncancel-order
      with: {order_id: $input.order_id}
  - name: stop-shipment
    kind: binding-call
    binding: binding.cancel-shipment
    with: {order_id: $input.order_id}
  - name: notify-customer
    kind: binding-call
    binding: binding.send-cancellation-email
    with: {order_id: $input.order_id, customer_id: $fact.customer_id}
---
