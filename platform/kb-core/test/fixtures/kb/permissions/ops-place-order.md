---
id: permission.ops-place-order
kind: Permission
title: Operations leads may place orders
operation: action.place-order
roles: [role.ops-lead]
level: 1
condition: context.order_total <= 1000
---
