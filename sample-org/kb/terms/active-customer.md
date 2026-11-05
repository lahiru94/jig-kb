---
id: term.active-customer
kind: Term
title: Active customer
definition: A customer who is currently engaged with Brightmere. Marketing and Finance measure this differently.
defines: [entity.customer]
claims:
  - says: A customer is active if they logged in during the last 90 days
    source: code:sample-org/services/storefront/src/main.ts#L3
    confidence: inferred
  - says: A customer is active if they bought something in the last 12 months
    source: code:sample-org/legacy-erp/src/erp.ts#L69
    confidence: inferred
conflicts:
  - about: definition of an active customer
    claims: [0, 1]
    status: open
---
