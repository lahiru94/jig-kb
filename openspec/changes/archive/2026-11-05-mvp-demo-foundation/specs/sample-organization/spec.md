# Spec Delta

## Purpose

Provides a realistic fictional retailer, with working systems, documents, history and deliberately planted problems, that serves both as the demo organization and as the benchmark for extraction and impact analysis.

## ADDED Requirements

### Requirement: Fictional retailer with working systems
The sample organization SHALL be a fictional mid-size retailer selling online and in stores with a loyalty programme. It SHALL include runnable services for storefront, orders, payments, returns and refunds, loyalty, tax, notifications, warehouse, and a legacy ERP with a nightly finance job.

#### Scenario: Services run locally
- **WHEN** the sample organization is started
- **THEN** each service is reachable and an order can be placed, delivered and refunded end to end

### Requirement: Business documents
The sample organization SHALL include business documents, at least a refund policy, a loyalty programme terms document, and process notes, that state rules in business language.

#### Scenario: Policy document
- **WHEN** the refund policy document is read
- **THEN** it states a 30-day refund window for all customers

### Requirement: Planted problems
The sample organization SHALL contain these planted problems:
- the policy says 30 days, but code allows 45 days for Gold members
- an undocumented loyalty points clawback that applies only after a cut-off date
- a nightly finance job that assumes one refund per order
- conflicting definitions of "active customer" in two systems
- an EU 14-day withdrawal right stated nowhere in code
- a gift-card refund reconciliation done manually, recorded only in staff notes

#### Scenario: Partial refund breaks the finance job
- **WHEN** two partial refunds are made on one order without any KB involvement
- **THEN** the nightly finance job produces an incorrect result

### Requirement: Operational history
The sample organization SHALL include seeded operational history: past orders, refunds and approval decisions, including frequent human overrides of the refund approval limit. This SHALL be enough for replay simulation and evidence-based proposals to produce meaningful results.

#### Scenario: Override evidence exists
- **WHEN** the seeded history is analysed for the refund approval limit rule
- **THEN** the human override rate is above the configured proposal threshold

### Requirement: Ground-truth KB
The sample organization SHALL include a hand-written, validated KB covering the refunds capability, including every planted problem, that serves as the correct answer for extraction benchmarks.

#### Scenario: Ground truth covers planted problems
- **WHEN** the ground-truth KB is queried
- **THEN** each planted problem is represented as a rule, conflict, gap or dependency

### Requirement: Second capability for the platform acceptance test
The sample organization SHALL include a small second capability, order cancellation, with its systems, documents and KB files, so that the platform can be shown to support it with no platform code changes.

#### Scenario: Cancellation through the platform
- **WHEN** an agent requests an order cancellation through act
- **THEN** it is evaluated and executed using only the cancellation KB files and bindings

### Requirement: Resettable demo state
The sample organization SHALL be resettable to a known starting state, including systems, data, history and KB version, so that the demo is repeatable.

#### Scenario: Reset after a demo
- **WHEN** a reset is run after a demo that applied deltas and executed actions
- **THEN** the systems, data, audit history and KB return to the starting state
