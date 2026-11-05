---
id: action.place-order
kind: Action
title: Place an order
mode: connected
part-of: [capability.ordering]
resource: entity.order
inputs:
  - name: order_id
    type: string
    required: true
facts:
  - name: order_total
    type: int
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: total
steps:
  - name: submit
    kind: binding-call
    binding: binding.submit-order
    with: {order_id: $input.order_id}
    compensate:
      binding: binding.cancel-submission
      with: {order_id: $input.order_id}
---
