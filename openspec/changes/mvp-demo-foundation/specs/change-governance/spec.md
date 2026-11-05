# Spec Delta

## Purpose

Governs how the KB itself changes: requirements are expressed as deltas to the model, assessed for system and operational impact, approved according to risk, and applied, with guardrail changes always reserved for humans.

## ADDED Requirements

### Requirement: Requirements are deltas to the model
A proposed change SHALL be a delta: a set of node additions, modifications and removals against a base version of the KB, with a title, rationale, proposer and status (draft, proposed, approved, rejected, applied). A delta SHALL NOT alter the main KB until it is applied.

#### Scenario: Draft delta isolated
- **WHEN** an agent proposes a delta raising a refund approval limit
- **THEN** the main KB is unchanged and the delta can be viewed as before and after

### Requirement: Delta validation
A delta SHALL be validated against the schema as if it were applied. A delta that would produce an invalid KB SHALL NOT be proposed for approval.

#### Scenario: Delta would break a link
- **WHEN** a delta removes a node that other nodes link to
- **THEN** validation reports each broken link and the delta stays in draft

### Requirement: Impact analysis
For any delta, the system SHALL list every node reachable from the changed nodes through impact-relevant links, with each node's link path from the change and a risk ranking.

#### Scenario: Partial refunds ripple
- **WHEN** impact is analysed for a delta that allows partial refunds
- **THEN** the result includes the loyalty-points clawback rule, the nightly finance job and the customer notification template, each with its link path

### Requirement: Replay simulation
For a delta that changes rules, policies or derivations, the system SHALL replay recorded past action requests from the audit log against the proposed KB and report how decisions would differ: counts by outcome, changed levels, and example cases.

#### Scenario: Approval limit change replayed
- **WHEN** a delta raising the approval limit from 500 to 800 is simulated over the last 30 days
- **THEN** the report shows how many past refunds would have changed from requires-approval to permit, and lists examples

#### Scenario: Replay is deterministic
- **WHEN** the same simulation is run twice on the same delta and audit window
- **THEN** both reports are identical

### Requirement: Permission-level approval of deltas
Applying a delta SHALL be governed by the KB's permission declarations, like any other operation. At level 1 it is applied without manual approval and audited, at level 2 a permitted human must approve it, and at level 3 it cannot be applied.

#### Scenario: Level 1 delta
- **WHEN** a delta only corrects a rule's wording, and such deltas are declared level 1 for the user
- **THEN** it is applied without manual approval and recorded in the audit log

#### Scenario: Level 2 delta
- **WHEN** a delta changes a rule's check, and such deltas are declared level 2 for the user
- **THEN** it stays proposed until a permitted human approves it from a view

### Requirement: Permission changes are never autonomous
Any delta that changes permission declarations or policies SHALL be treated as at least level 2, whatever the KB declares. This floor SHALL NOT be changeable through the KB.

#### Scenario: KB declares permission changes autonomous
- **WHEN** the KB declares permission changes level 1, and an agent proposes a delta raising its own autonomy
- **THEN** the delta still requires approval by a permitted human, and the agent cannot approve it

### Requirement: Evidence-based delta proposals
The system SHALL monitor operate-loop outcomes. When humans override the same rule decision at or above a configured rate within a window, it SHALL draft a delta proposal citing the evidence and assign it to the rule's owner.

#### Scenario: Frequent overrides
- **WHEN** humans approve 96 percent of the exceptions raised by the refund approval limit rule in a week, above a configured threshold of 80 percent
- **THEN** a draft delta is created that cites the override count and rate, and is assigned to the rule owner

### Requirement: Applied deltas are versioned
Applying a delta SHALL create a new KB version recording the delta, its approvers and its simulation results. It SHALL be possible to view the KB as of any earlier version.

#### Scenario: View before a change
- **WHEN** a user asks to see the refund rules as of the version before a delta was applied
- **THEN** the system shows the rules as they were in that version
