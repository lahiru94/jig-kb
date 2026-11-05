# Spec Delta

## Purpose

Provides the typed operation surface through which agents read, change and act on the KB, so that agents choose which operation to call and with what arguments while the KB layer enforces guardrails.

## ADDED Requirements

### Requirement: Operations exposed as typed tools over MCP
The KB SHALL expose at least these operations as MCP tools: query, visualize, propose_delta, analyze_impact, simulate, act and approve. Each tool SHALL have typed inputs and outputs, described well enough for an agent to choose and call it without extra instructions.

#### Scenario: Agent discovers tools
- **WHEN** an MCP client connects and lists tools
- **THEN** it receives each operation with its name, description and input schema

### Requirement: Inputs validated before execution
Every operation call SHALL be validated against its input schema and against the KB's node ids before any effect occurs. An invalid call SHALL be rejected with a structured error and have no side effects.

#### Scenario: Unknown node id
- **WHEN** an agent calls analyze_impact on a delta that references a non-existent node
- **THEN** the call is rejected with an error naming the missing id, and nothing is written

### Requirement: Guardrails enforced by the layer on every call
Every operation call SHALL be evaluated against the KB's permission declarations, rules and policies before it executes. Guardrails SHALL NOT depend on the agent's prompt or cooperation.

#### Scenario: User lacks permission
- **WHEN** an agent acting for a user whose role has no permission for an action calls act
- **THEN** the call is denied at level 3 with the reasons, and nothing is executed

### Requirement: Agents act with the logged-in user's permissions, capped by level 2
An agent SHALL be evaluated with the permissions of the logged-in user it acts for. An operation that is level 2 for that user SHALL NOT be completed by the agent: the agent may only request it, and a permitted human must approve it or perform it directly. Approving is always a human-only step.

#### Scenario: Level 1 for the user
- **WHEN** an agent acting for an operator requests a refund of 200, declared level 1 for operators
- **THEN** the refund proceeds without human approval

#### Scenario: Level 2 for the user
- **WHEN** an agent acting for an operator requests a refund of 800, declared level 2 for operators
- **THEN** the request is queued for approval and nothing is executed until a permitted human approves

#### Scenario: Agent calls approve
- **WHEN** an agent calls approve on any pending request, including in a session whose user is permitted to approve
- **THEN** the call is denied, and the request stays pending for a human

### Requirement: Structured decisions with reasons
Every call that is denied or needs approval SHALL return a structured decision: a level (1, 2 or 3), the rule, policy and permission ids involved, and a plain-language reason.

#### Scenario: Plain-language reason
- **WHEN** an action is denied because of a business rule
- **THEN** the response includes the rule id and the rule's plain-language statement

### Requirement: Query operation
The query operation SHALL return nodes and links matching a filter on kind, attributes, link traversal from a focus node to a depth, or text. Each result SHALL include provenance and confidence.

#### Scenario: Rules for a capability
- **WHEN** an agent queries for BusinessRules linked to `capability.returns`
- **THEN** it receives those rules with their statements, claims, conflicts and confidence

### Requirement: Every call is audited
Every operation call SHALL be recorded in an append-only audit log with the principal, operation, inputs, decision, outcome and timestamp.

#### Scenario: Denied call is audited
- **WHEN** a call is denied
- **THEN** the audit log contains an entry for it with the decision and reasons

### Requirement: Operations are capability-agnostic
Operations SHALL behave the same for any capability modelled in the KB. Adding a capability SHALL require only KB files and bindings, with no change to the operations.

#### Scenario: Second capability
- **WHEN** KB files and bindings for an order-cancellation capability are added
- **THEN** query, act, propose_delta, analyze_impact and simulate work for it without code changes
