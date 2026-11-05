# Spec Delta

## Purpose

Lets users see and work with any subset of the KB on demand through views rendered from KB data, so that non-technical people can understand, question, correct and approve the model by pointing rather than describing.

## ADDED Requirements

### Requirement: Visualize a scoped subset
The visualize operation SHALL render a view of a KB subset, given:
- a scope: a focus node with depth, a capability, a query, or a delta
- a view type
- optional overlays
- an optional as-of version or delta

#### Scenario: Explore a neighbourhood
- **WHEN** visualize is called with focus `capability.returns`, depth 2 and the explorer view
- **THEN** a view shows that capability and every node within two links of it

### Requirement: MVP view catalogue
The system SHALL provide at least these view types: explorer, process flow, rule card, impact ripple and before/after.

#### Scenario: Rule card
- **WHEN** a rule card is shown for `rule.refund-window`
- **THEN** it shows the plain-language statement, claims with their sources and confidence, conflicts, owner and enforcement locations

#### Scenario: Before and after
- **WHEN** before/after is shown for a delta
- **THEN** each changed node is shown side by side with additions, changes and removals marked

### Requirement: Views show only KB content
Every element in a view SHALL correspond to a KB node, link or claim, and SHALL be traceable to it. Views SHALL NOT show content that is not in the KB or the delta being viewed.

#### Scenario: Trace an element
- **WHEN** a user opens the details of any box in a view
- **THEN** they see the node id and the provenance of what is shown

### Requirement: Overlays
Views SHALL support the overlays confidence, conflicts, ownership, enforcement and pending-delta. Each overlay SHALL mark the elements it applies to without changing the scope.

#### Scenario: Conflict overlay
- **WHEN** the conflicts overlay is turned on for the refunds process view
- **THEN** the refund window rule is marked as having an open conflict

### Requirement: Interaction events return to the agent
User interactions on a view SHALL be sent to the agent session as structured events with the action (select, ask, comment, suggest-edit, approve or reject), the target element id and any text.

#### Scenario: Suggest an edit
- **WHEN** a user suggests "Gold members get 45 days" on the refund window rule
- **THEN** the agent receives a suggest-edit event targeting `rule.refund-window` with that text

### Requirement: Edits become draft deltas
An edit made through a view SHALL create or update a draft delta. It SHALL NOT change the KB directly, and saving SHALL propose the delta for governance.

#### Scenario: Save an edit
- **WHEN** a user saves an edit in a view
- **THEN** a delta is proposed and the main KB is unchanged until the delta is approved and applied

### Requirement: Approvals are visual
Any human approval, of a delta or of an action, SHALL be given from a view that shows what is being approved, including its impact or decision reasons.

#### Scenario: Approving a delta
- **WHEN** an approver approves a delta
- **THEN** the approval is made from a view showing the before/after and the impact

### Requirement: Large subsets stay readable
When a subset exceeds the view's size limit, the view SHALL collapse groups of nodes into summary elements that can be expanded on demand.

#### Scenario: Collapse a large system
- **WHEN** a scope includes 42 rules in the payments system
- **THEN** the view shows a single "Payments: 42 rules" element that expands when selected
