# guarded-actions Specification

## Purpose

Lets agents run business operations only as typed actions defined in the KB, with facts gathered through bindings, rules and policies checked by the KB layer, human approval when required, and a complete audit trail.

## Requirements

### Requirement: Actions are defined in the KB
An Action SHALL be a KB node that declares its typed inputs, the rules and policies attached to it, its steps, and the bindings each step uses. Only actions defined in the KB SHALL be executable.

#### Scenario: Undefined action
- **WHEN** an agent calls act with an action id that is not in the KB
- **THEN** the call is rejected and nothing is executed

### Requirement: Facts gathered before evaluation
Before evaluating an action, the system SHALL gather every fact its rules and policies need through bindings, then compute derived facts, and record all of these facts in the audit entry. Evaluation SHALL use only the recorded facts.

#### Scenario: Derived fact recorded
- **WHEN** a partial refund is requested for an order delivered 38 days ago
- **THEN** the audit entry records `days_since_delivery = 38` with the inputs it was derived from

### Requirement: Deterministic decisions
For the same action, principal, inputs, recorded facts and KB version, evaluation SHALL always produce the same decision.

#### Scenario: Re-evaluation
- **WHEN** a recorded action request is re-evaluated against the same KB version
- **THEN** the decision matches the original

### Requirement: Rule violations block execution
If any enforced rule or policy forbids an action, the system SHALL NOT execute any step and SHALL return a deny decision with the reasons.

#### Scenario: Loyalty clawback rule blocks a partial refund
- **WHEN** an agent requests a partial refund on an order whose loyalty points cannot be clawed back under the current rules
- **THEN** no system is changed, and the response names the clawback rule with its plain-language statement

### Requirement: Approval gates
When a decision is level 2, the system SHALL queue the action with its facts and decision for a human permitted to approve it. The approver may be the logged-in user the agent acts for. The action SHALL execute only after approval, and any rejection SHALL be recorded.

#### Scenario: Human approves an exception
- **WHEN** an approver approves a queued refund exception
- **THEN** the action executes and the audit log records the approver and that this was an override

#### Scenario: Logged-in user approves their agent's request
- **WHEN** the agent acting for an approver-role user queues a level 2 refund, and that user approves it from the view
- **THEN** the action executes and the audit log records the user as approver

#### Scenario: Agent cannot approve
- **WHEN** the requesting agent calls approve on its queued action
- **THEN** the approval is denied and the action stays queued

### Requirement: Bindings execute steps against systems
Each action step SHALL run through a binding, at least of type REST or SQL, defined in the KB. The binding maps KB entities and inputs onto the target system's call.

#### Scenario: Step through a REST binding
- **WHEN** an approved refund runs its payment step
- **THEN** the payments service receives the call defined by the binding, with values mapped from the action inputs

### Requirement: Multi-step compensation
If a step of a multi-step action fails, the system SHALL run the defined compensations for completed steps in reverse order, and SHALL report the action as failed, with each step's outcome.

#### Scenario: Loyalty step fails
- **WHEN** the payment step succeeds but the loyalty clawback step fails
- **THEN** the payment compensation runs and the audit entry shows each step's outcome

### Requirement: Complete audit trail
Every action request SHALL produce an audit entry containing:
- principal, action and inputs
- recorded facts and KB version
- decision and approvals
- step outcomes and final outcome

#### Scenario: Audit supports replay
- **WHEN** a simulation reads a past audit entry
- **THEN** the entry contains everything needed to re-evaluate the decision without calling any system
