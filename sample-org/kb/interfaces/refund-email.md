---
id: interface.refund-email
kind: Interface
title: Refund confirmation email
part-of: [component.notifications-service]
claims:
  - says: The refund email says the order has been fully refunded
    source: code:sample-org/services/notifications/src/main.ts#L17
    confidence: inferred
---
Template `refund_completed`. It assumes a full refund, so it is wrong for partial refunds.
