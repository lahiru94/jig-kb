# Spec Delta

## Purpose

Provides the conversational experience in which an agent drives the engagement, using KB operations to answer, show views, propose changes and run actions on behalf of the user in their current role.

## ADDED Requirements

### Requirement: Agent acts only through KB operations
The session agent SHALL read, change and act on the KB and the underlying systems only through KB operations. It SHALL have no direct access to KB files, databases or system APIs.

#### Scenario: Agent changes a rule
- **WHEN** a user asks the agent to change a rule
- **THEN** the agent calls propose_delta, and no file is written outside the delta workflow

### Requirement: Show or tell
The agent SHALL show a view rather than answer only in text when the answer involves relationships, more than five items, a comparison or an approval. Otherwise it MAY answer in text.

#### Scenario: Relationship question
- **WHEN** a user asks "what depends on the refunds process?"
- **THEN** the agent calls visualize and explains the view it shows

#### Scenario: Simple fact
- **WHEN** a user asks who owns the refund window rule
- **THEN** the agent answers in text with the owner and the source

### Requirement: Shared working set
The session SHALL keep a working set of the views currently shown and the elements the user has selected. The agent SHALL resolve references such as "this" or "that rule" against the working set.

#### Scenario: Referring to a selection
- **WHEN** a user selects the loyalty clawback rule and asks "why does this exist?"
- **THEN** the agent answers about the loyalty clawback rule

### Requirement: Agent uses the logged-in user's permissions
Each session SHALL belong to a logged-in user in a role, such as executive, approver or operator. The agent SHALL receive that user's permissions, limited by level 2 rules: it may request level 2 operations but never complete or approve them. Approvals SHALL come only from the user's own approve events in a view. The MVP SHALL allow switching roles within a session for demonstration.

#### Scenario: Switch to approver
- **WHEN** the user switches the session role from operator to approver, and then approves a queued request from the view
- **THEN** the approval is evaluated with approver permissions and succeeds

#### Scenario: Agent in an approver session
- **WHEN** the session role is approver and the agent itself calls approve
- **THEN** the call is denied

### Requirement: Answers cite the KB
When the agent states a fact about the organization, it SHALL cite the node it came from. It SHALL say when the KB holds no supporting fact, or only an inferred or conflicting one.

#### Scenario: No supporting fact
- **WHEN** a user asks about a policy the KB does not contain
- **THEN** the agent says the KB has no record of it and offers to record it as a gap

### Requirement: Decisions explained in plain language
When an operation is denied or needs approval, the agent SHALL explain the decision to the user in plain language, using the rules and reasons returned by the KB layer.

#### Scenario: Blocked refund explained
- **WHEN** a partial refund is denied by the loyalty clawback rule
- **THEN** the agent tells the user which rule blocked it, why the rule exists, and what options exist, such as requesting an exception
