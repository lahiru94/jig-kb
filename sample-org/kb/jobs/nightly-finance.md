---
id: job.nightly-finance
kind: Job
title: Nightly finance report
part-of: [component.legacy-erp]
depends-on: [rule.single-refund-per-order, interface.erp-postings]
claims:
  - says: Runs at 02:00 UTC and reports net revenue per order from ERP postings
    source: code:sample-org/legacy-erp/src/erp.ts#L47-L67
    confidence: inferred
---
Finance's monthly close relies on this report.
