# kb-model Specification

## Purpose

Defines the knowledge base's meta-model and canonical storage: what kinds of facts the KB holds about an organization's real world and digital implementation, how they are linked and sourced, and how they are stored, validated and indexed.

## Requirements

### Requirement: Real-world and digital node kinds
The KB SHALL support real-world node kinds (Goal, Constraint, Capability, Process, Step, BusinessRule, Term, Actor, Role, Decision) and digital node kinds (System, Component, Interface, DataEntity, Job, Agent), plus the operational kinds Action, Binding, Policy and Derivation. Every node SHALL have a unique, stable id, a kind, and a title.

#### Scenario: Node of a known kind is accepted
- **WHEN** a node file declares `kind: BusinessRule`, a unique id and a title
- **THEN** validation accepts the node and the index exposes it under that id

#### Scenario: Unknown kind is rejected
- **WHEN** a node file declares a kind that is not in the meta-model
- **THEN** validation fails with an error naming the file and the unknown kind

### Requirement: Typed links between nodes
The KB SHALL represent relationships as typed links: at least implements, realizes, governed-by, defines, depends-on, owned-by, decided-by, enforced-on and binds-to. The schema SHALL constrain which node kinds each link type may connect.

#### Scenario: Valid link
- **WHEN** a BusinessRule declares `implemented-by` pointing to an existing Component
- **THEN** validation accepts it and the index records the link in both directions

#### Scenario: Dangling link
- **WHEN** a node links to an id that does not exist
- **THEN** validation fails with an error naming the source node and the missing target

#### Scenario: Link between disallowed kinds
- **WHEN** a Term declares `implemented-by` pointing to a Role
- **THEN** validation fails with an error naming the link type and the disallowed kinds

### Requirement: Claims with provenance and confidence
Each fact stated on a node SHALL be recordable as a claim carrying a source reference (code location, document location, person or meeting), a confidence level (inferred, stated or verified), and optionally who verified it and when.

#### Scenario: Claim inferred from code
- **WHEN** a claim records source `code:returns-service/src/policy/window.ts#L12-L28` and confidence `inferred`
- **THEN** the claim is queryable with its source and confidence

#### Scenario: Claim without a source
- **WHEN** a claim omits its source
- **THEN** validation fails for that node

### Requirement: Explicit conflicts
When two or more claims about the same fact disagree, the KB SHALL record the conflict explicitly with a status (open or resolved), rather than silently keeping one claim. A resolved conflict SHALL record the chosen claim and who resolved it.

#### Scenario: Policy contradicts code
- **WHEN** one claim says the refund window is 30 days (from a policy document) and another says 45 days for Gold members (from code)
- **THEN** the node shows an open conflict that references both claims

#### Scenario: Conflict resolved
- **WHEN** an owner resolves the conflict in favour of one claim
- **THEN** the conflict status becomes resolved and records the chosen claim and the resolver

### Requirement: Business rules carry both a statement and an enforcement record
A BusinessRule SHALL have a plain-language statement. It MAY have an executable check, and SHALL record where it is enforced: in the KB layer, in named components, or not enforced.

#### Scenario: Rule enforced in two places
- **WHEN** a rule is enforced both by the KB layer and by a legacy component
- **THEN** the rule's enforcement record lists both locations

#### Scenario: Rule with no check
- **WHEN** a rule has a statement but no executable check
- **THEN** the KB reports it as known but not enforceable by the KB layer

### Requirement: Canonical store is plain-text files in git
The canonical KB SHALL be a git repository of Markdown files with YAML frontmatter, one node per file. Structured facts SHALL be in frontmatter and narrative in the body. Every other representation SHALL be derivable from these files.

#### Scenario: Rebuild from files
- **WHEN** all derived indexes are deleted and rebuilt from the repository
- **THEN** the rebuilt KB answers every query identically to before

### Requirement: Versioned schema validates every commit
The meta-model SHALL be defined in a versioned schema. Every commit to the KB repository SHALL be validated against it, and invalid commits SHALL be reported with file-level errors.

#### Scenario: Invalid commit reported
- **WHEN** a commit introduces a node missing a required field
- **THEN** validation reports the file, the field and the schema version used

### Requirement: Deterministic semantic projection
Every node file SHALL map to the same set of RDF triples each time it is projected. Projection SHALL be lossless for frontmatter facts.

#### Scenario: Stable projection
- **WHEN** the same file is projected twice
- **THEN** both projections produce identical triples

### Requirement: Data entities are fully typed
A DataEntity SHALL declare its fields, each with a type and any constraints, and its identity (which fields uniquely identify an instance). A field without a type SHALL be rejected.

#### Scenario: Untyped field rejected
- **WHEN** a DataEntity declares a field `amount` with no type
- **THEN** validation fails with an error naming the entity and the field

#### Scenario: Identity declared
- **WHEN** a DataEntity `Order` declares identity `[order_id]`
- **THEN** the index exposes `order_id` as the identity of Order

### Requirement: Operating mode of systems, components and actions
Every System, Component and Action SHALL record its mode: described (modelled but not operated), connected (operated through bindings to an existing system) or native (hosted by the platform). A missing mode SHALL default to described. Only connected and native elements SHALL be operable.

#### Scenario: Described element in impact analysis
- **WHEN** a delta changes a rule that the described legacy ERP finance job depends on
- **THEN** impact analysis lists the finance job, even though the platform does not operate it

#### Scenario: Acting on a described action
- **WHEN** an agent calls act on an action whose mode is described
- **THEN** the call is rejected with the reason that the action is not operable

### Requirement: Permission declarations
The KB SHALL declare permissions as nodes, each stating an operation or action, the users or roles it applies to, an optional condition, and a level: 1 (autonomous: an agent may do it on its own), 2 (human-required: a permitted human must approve or do it), or 3 (forbidden: nobody may do it). An operation with no applicable declaration SHALL be treated as level 3.

#### Scenario: Conditional levels
- **WHEN** the KB declares refunds of at most 500 as level 1 for operators, and refunds above 500 as level 2 for operators
- **THEN** the index exposes both declarations, with their conditions, for the refund action

#### Scenario: Undeclared operation
- **WHEN** a user's role has no declaration for an action
- **THEN** the action is level 3 for that user

### Requirement: Derived graph index
The KB SHALL maintain a graph index derived from the files that supports lookup by id, filtering by kind and attributes, traversal of links in both directions, and text search.

#### Scenario: Backlinks
- **WHEN** a client asks which nodes link to `component.returns-service`
- **THEN** the index returns every node that links to it, with each link's type
