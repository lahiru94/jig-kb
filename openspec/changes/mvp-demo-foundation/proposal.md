# Proposal

## Why

Large organizations increasingly run on systems that nobody fully understands, and AI agents add to that complexity. Requirements get lost between the business and its implementation. Clients can't articulate the problem, teams misread requirements, changes break existing behavior, the current system can't be explained, and requirement gathering never converges. As agents start running business operations, requirements become the operating rules those agents follow. Managing those rules therefore becomes the governance of an AI-run business.

jig is a knowledge base (KB) that models what a company is in the real world, how that is represented and implemented digitally, and why. Agents act through it, under guardrails and human oversight. This change sets up the foundation and an MVP whose first goal is a convincing end-to-end demo to a non-technical audience.

## What Changes

- Introduce the **core KB model**: real-world nodes (goals and constraints, capabilities, processes, business rules, terms, actors and roles, decisions) and digital nodes (systems, components, interfaces, data entities, jobs and agents). These are joined by typed links. Every fact carries provenance (source, confidence, verification). Contradictory claims and where each rule is enforced are recorded explicitly.
- Make **plain-text files in git the canonical store**: Markdown with YAML frontmatter, one node per file. A rigorous, versioned schema (LinkML compiling to JSON Schema, SHACL and a JSON-LD context) validates every commit. Each file has a deterministic RDF projection. The vocabulary is borrowed from ArchiMate, Backstage, Gherkin, ADR and DMN rather than invented. Graph indexes and search are derived and can be rebuilt from the files.
- Expose the KB to agents only through **typed KB operations** served over MCP: query, visualize, propose delta, analyze impact, simulate, act and approve. Guardrails are enforced by the KB layer, not by agents.
- Support **two loops sharing one model**, both governed by three permission levels declared in the KB: level 1 (an agent may do it on its own), level 2 (a permitted human must approve it or do it), and level 3 (nobody may do it). Agents act with the logged-in user's permissions, but can only request level 2 operations:
  - **Change loop** (governance): a requirement is a delta to the model. Each delta gets impact analysis across systems and processes, plus a simulation that replays past operations. Applying a delta follows the same permission levels. Recurring operational exceptions generate evidence-based delta proposals.
  - **Operate loop** (purpose): agents run business operations as typed actions with preconditions, executable rule checks, policies, approval gates and an audit trail. Actions reach real systems through bindings.
  - Agents never approve anything. Changes to permissions or policies are always at least level 2, whatever the KB declares.
- Provide an **agent-driven experience with on-demand visualization**. The agent decides when to show rather than tell, and calls `visualize(scope, view, overlays, as-of)` on a subset of the KB. The view catalogue covers landscape, process flow, rule card, gaps, before/after, impact ripple, scenarios, and a neighborhood explorer. Overlays cover confidence, conflicts, ownership, enforcement and pending delta. Users approve, comment, ask or edit in the view. Their interactions return to the agent as structured events, and edits become draft deltas, never direct writes. Approvals are always visual.
- Provide **agent-assisted extraction** that drafts part of the model from code and documents, and visibly does so during the demo.
- Build a **fictional sample organization**: a mid-size retailer (online, stores, loyalty) with about 8 services including a legacy ERP. It has real code, documents and deliberately planted problems: a policy that contradicts the code, a hidden loyalty-points clawback, a finance job that assumes one refund per order, conflicting definitions of "active customer", a regulation that appears nowhere in code, and a manual process known only to staff. It includes a hand-written ground-truth KB, so it doubles as an extraction benchmark.

- Adopt a **layered guardrail evaluation** approach:
  - Bindings (SQL, REST) supply raw facts.
  - Derivations in CEL compute facts.
  - Cedar policies make decisions: permit or forbid, with policy annotations carrying the permission level and rule references.
  - Action logic computes effects.

  The platform reaches Cedar only through an engine-neutral decision interface, and rule checks reserve an `engine:` field. Cedar was chosen because replay simulation needs deterministic evaluation, because guardrail changes need formal analysis, and because agent-authored policy needs a small, checkable language. It is also the easier choice to reverse: Cedar policies translate to Rego mechanically, but not the other way round.

### Demo scope

One full cycle over a single capability, refunds. An agent attempts a partial refund, a guardrail blocks it, and a human approves the exception. The pattern then produces a proposed delta. Impact analysis and replay simulation follow, a human approves the change, and the agent's retry succeeds. Extraction is shown live on part of the sample codebase.

### Platform scope

Everything refund-specific lives in KB data: rules, actions, derivations, bindings and policies. Platform code is generic. **Acceptance test:** a second, small capability (for example, order cancellation) can be added and demonstrated using only KB files and bindings, with no changes to platform code.

The MVP platform includes:
- **The full meta-model:** including Action, Binding, Policy and Derivation, with claims, provenance, conflicts and enforcement location.
- **Validation and indexing:** schema validation on every commit, and an in-memory graph index built from the files.
- **The operations surface:** the generic MCP server, with guardrails applied on every call.
- **Change governance:**
  - deltas as git branches
  - graph-based impact analysis
  - replay simulation over the audit log
  - permission levels declared in the KB
  - evidence-based proposals from override-rate thresholds
- **A generic action executor:**
  - precondition checks and policy evaluation
  - an approval queue and audit
  - REST and SQL bindings
  - multi-step actions with basic compensation
- **Views:** the visualize tool with about five fully built views (explorer, process, rule card, impact, before/after), overlays, interaction events, and edits that become draft deltas.
- **The agent session:** one agent runtime with a shared working set and role switching (executive, approver, operator).
- **Extraction:** from one repository plus documents, scored against the ground-truth KB.

The demo must never fake the core claims: guardrail enforcement, computed impact, replay over real audit records, live extraction, and real git deltas. Authentication, multi-user support and hosting can be simplified.

Out of scope for this change: connectors to real client systems, real client data, capabilities beyond refunds, fine-grained per-record permissions, live co-editing, a triplestore as the primary store, and continuous drift detection beyond a minimal demonstration.

## Capabilities

### New Capabilities
- `kb-model`: The meta-model (node kinds, typed links, claims with provenance and confidence, conflicts, enforcement location, actions, bindings, policies, derivations), the canonical file format, schema validation and the derived index.
- `kb-operations`: The typed operation surface agents use (query, visualize, propose delta, analyze impact, simulate, act, approve), exposed over MCP, with guardrails enforced in the layer.
- `change-governance`: The change loop. Deltas against the model, impact analysis, replay simulation, approval by permission level, evidence-driven delta proposals, and the floor that permission and policy changes always need a human.
- `guarded-actions`: The operate loop. Typed business actions with preconditions, executable rule checks, policies, approval gates, bindings to underlying systems, and audit.
- `kb-visualization`: On-demand views of KB subsets (view catalogue, explorer, overlays, as-of and branch views). It also covers the interaction events returned to the agent, and conversion of edits into draft deltas.
- `agent-session`: The agent-driven conversational experience. It decides between showing and telling, keeps a shared working set of what is on screen or selected, and orchestrates the loops.
- `kb-extraction`: Agent-assisted drafting of model nodes and links from code and documents, with provenance and confidence attached.
- `sample-organization`: The fictional retailer (code, documents, planted problems), its ground-truth KB and the extraction benchmark.

### Modified Capabilities
- None. The project has no existing specs.

## Impact

- Greenfield: new KB schema, operations service (MCP server), agent runtime, web UI for views, and the sample retailer codebase and documents.
- New dependencies:
  - LinkML and JSON Schema for the schema
  - Cedar for policy decisions
  - CEL for derivations
  - MCP
  - a Claude-based agent runtime
  - a web front end for the views
- The canonical KB lives in git, so review, history and branch-based previews rely on git workflows.
- Risks carried into design:
  - Assembling the Cedar entity graph for each request is real engineering work.
  - Cedar's datetime extension is not yet covered by formal analysis.
  - Type-aware partial evaluation is experimental.
