# Design

## Context

The repository is greenfield: it holds only OpenSpec configuration and no code. See proposal.md for motivation and scope, and the specs under `specs/` for required behavior. Three constraints shape this design:
- The MVP must demo well to a non-technical audience.
- Platform code must stay capability-agnostic. Refunds live only in KB data.
- The demo must never fake its core claims.

## Goals / Non-Goals

**Goals:**
- One platform codebase that runs the full refunds cycle and the order-cancellation acceptance test from KB data alone.
- Deterministic guardrail evaluation, so replay simulation is trustworthy.
- A single-machine setup the team can start, demo and reset with one command each.

**Non-Goals:**
- Production hardening: high availability, horizontal scale, multi-tenancy, SSO.
- A general connector framework beyond REST and SQL bindings.
- Policy formal analysis features exposed to users. Choosing Cedar keeps them available, but the MVP does not build UI for them.
- Native feature hosting: platform-managed storage for entities, a process or workflow engine, and screens generated from entities. These are future work on top of D16. The MVP only keeps their extension seams open.

## Decisions

### D1. TypeScript monorepo for the platform
Platform services, the MCP server, the web UI and the sample services are written in TypeScript in one monorepo. LinkML tooling, which is Python, runs only at build time to generate JSON Schema and the JSON-LD context.
- **Why:** one language across the MCP SDK, the UI and Cedar (official WASM bindings), and a fast path to a polished UI.
- **Alternatives considered:**
  - Python platform: strong LinkML and data tooling, but a weaker UI story and two languages anyway.
  - Rust core: native Cedar, but slower to iterate on for an MVP.
- **Status:** confirmed by the user.
- **Strict TypeScript:** all packages compile in strict mode, and CI fails any push where `typecheck` fails.

### D2. Repository layout separates platform, KB content and the sample organization

```
platform/
  kb-core/        schema, loader, validator, index, projection
  kb-ops/         MCP server: operations + guardrail pipeline + audit
  governance/     deltas, impact, simulation, evidence proposals
  executor/       actions, bindings, approvals, compensation
  extraction/     agent extraction pipeline + benchmark scorer
  session/        agent session server (Claude via Agent SDK, MCP client)
  web/            chat + view pane, view catalogue
schema/           LinkML source of the meta-model (versioned)
sample-org/
  services/       storefront, orders, payments, returns, loyalty, tax,
                  notifications, warehouse
  legacy-erp/     deliberately old-style ERP + nightly finance job
  docs/           policies, loyalty terms, staff process notes
  history/        seed generator for orders, refunds, approvals
  kb/             ground-truth KB (its own git repo at runtime)
```

- **Why:** the separation makes the platform acceptance test meaningful. Nothing under `platform/` may reference refunds or cancellations, and a lint check enforces this.

### D3. KB file conventions
- One node per file, at `<kind-plural>/<slug>.md`.
- The id is `<kind>.<slug>`, stable across renames. Renaming a file does not change its id.
- Links are frontmatter fields named by link type, holding id lists. Claims are a frontmatter list with `says`, `source`, `confidence` and optional `verified_by` / `verified_at`. Conflicts are frontmatter entries referencing claim indexes.
- Operational nodes (Action, Binding, Policy, Derivation) use the same format. Cedar policy text and CEL expressions live in fenced blocks in the body, and the loader parses them.
- **Why:** humans can read the files, agents can edit them, and diffs stay small.
- **Alternative considered:** separate `.cedar` and `.cel` files. Rejected because it splits one logical node across files.

### D4. Schema and validation
- LinkML is the source of truth for the meta-model. It generates JSON Schema (frontmatter validation) and a JSON-LD context (RDF projection).
- The validator also performs graph-level checks that JSON Schema cannot express:
  - dangling links
  - disallowed kind pairs
  - claim and conflict integrity
  - Cedar policies validated against the Cedar schema generated from the KB
  - CEL expressions type-checked
- Validation runs as a git pre-commit hook and on every delta before it is proposed.

### D5. In-memory derived index
- The loader reads all files into an in-memory graph with forward and reverse adjacency, kind and attribute indexes, and a simple text index.
- The index is rebuilt on startup and incrementally on commit.
- **Why:** the MVP KB is hundreds to low thousands of nodes, which is well within memory.
- **Alternative considered:** a triplestore. It is deferred. The RDF projection makes it a later drop-in for querying.

### D6. Deltas are git branches
- A delta is a branch off a base commit, plus a delta record (title, rationale, proposer, status, level, simulation reference).
- Proposing a delta validates the branch. Applying it merges with a merge commit that records approvers. "As-of" views read a commit.
- An overlay index (base index plus the delta's changes) lets views and simulation read a delta without checking it out.
- **Why:** history, diffs and as-of views come for free, and the KB files remain the only canonical state.

### D7. Guardrail pipeline is layered and pure after fact gathering

```
act(action, inputs, principal)
  1. resolve action node + attached rules/policies (KB version V)
  2. FACT GATHERING   bindings fetch RAW facts            (impure, recorded)
  3. DERIVATION       CEL computes derived facts from raw  (pure)
  4. ENTITY ASSEMBLY  build Cedar entities + context       (pure)
  5. DECISION         Cedar evaluates policies             (pure)
  6. ASSEMBLY         matched policy annotations ->        (pure)
                      {level, rule ids, reasons}
  7. permit -> execute steps | requires-approval -> queue | deny -> stop
  8. audit: raw facts, V, decision, approvals, step outcomes
```

- Raw binding results are recorded, not derived values. Replay therefore re-runs steps 3–6 against a proposed KB, so changes to derivations, rules and policies can all be simulated.
- Rule checks compile to Cedar `forbid` policies or to annotated `permit` policies. Annotations include `@rule("<id>")`, `@level("1|2|3")` and `@reason("<text>")`. The decision assembler starts from the user's permission declarations, which grant: the most permissive matching declaration sets the level, and an operation with none is level 3. Matched rule and policy forbids then raise the level, and the most restrictive wins. A rule or policy that cannot be evaluated fails closed at level 3. Cedar is called twice per decision, once with the permits alone and once with the forbids plus a catch-all permit, so that every matching policy is reported.
- **Entity assembly:** each Action declares its resources and the facts it needs. The assembler loads only those entities, using the declared derivations and bindings, so no general entity-slicing mechanism is needed.
- **The engine-neutral interface** is `evaluate(principal, action, resource, context) -> Decision`, and only `kb-ops` calls it. Rules default to `engine: cedar`. Any other value is rejected in the MVP.
- **Libraries:** Cedar via the official WASM package. CEL via a maintained JavaScript implementation, chosen in a short spike (task 1.3) on the criteria of type-checking support and deterministic evaluation.
- **Alternatives considered:**
  - OPA: rejected (see proposal).
  - A home-grown expression language for derivations: rejected because it adds a language to maintain.

### D8. Hard invariants enforced in code, not policy
Some guarantees must not be changeable by any KB content, because KB content is what they protect:
- Agents never approve anything. Approval is a human-only step.
- Deltas that change permission declarations or policies are at least level 2, whatever the KB declares.
- Every call is audited.

These are enforced in `kb-ops` before Cedar is consulted. Everything else about who may do what lives in the KB as permission declarations (see D17).
- **Why:** policy-only enforcement could be edited away by a delta.

### D9. Impact analysis
- A breadth-first traversal from the changed nodes over impact-relevant link types, in both directions, with a per-type weight and a depth limit.
- Each result records its link path. The risk rank combines path length, link weights, the target's kind (Action, Job and DataEntity rank higher) and whether the target is enforced by a component.
- **Why:** it is explainable. The path is the explanation shown in the impact ripple view.
- **Alternative considered:** LLM-judged impact. It is not deterministic or explainable. The agent may summarise the result, but must not compute it.

### D10. Replay simulation
- Simulation selects audit entries in a window for the actions affected by the delta and re-evaluates steps 3–6 using the delta's overlay index.
- It re-evaluates each request against the KB both before and after the delta, from the same recorded facts, and compares the two. Only the delta's own effect shows, not differences between today's KB and whatever decided the request originally. It then aggregates the differences and picks examples.
- When a delta needs a raw fact that was not recorded, for example a new binding, the affected entries are reported as "insufficient facts", not guessed.

### D11. Evidence-based proposals
- A scheduled evaluator computes, per rule, the override rate (approved exceptions as a share of requires-approval decisions) over a rolling window.
- When the rate exceeds a KB-configured threshold, it drafts a delta through the same `propose_delta` path, with the evidence attached, and assigns it to the rule owner.
- The delta body is drafted by an agent, but the trigger and the evidence numbers are computed deterministically.

### D12. Agent session and views
- The session server runs a Claude agent through the Agent SDK. Its only tools are the `kb-ops` MCP tools. The default model is `claude-sonnet-5-5` for latency, configurable to `claude-opus-5-5`.
- The web app has a chat pane and a view pane. `visualize` returns a view spec, meaning view type, scoped node and link data, and overlays, never HTML. The web app renders it with a fixed component catalogue.
- UI events go to the session server over a WebSocket and are added to the agent's context as structured messages. The server keeps the working set, which records the views shown and the current selection.
- Show-or-tell is implemented as agent instructions.
- Approvals never go through an agent tool call. When the user clicks approve in a view, the session server sends the approval to kb-ops directly, as the human user.
- **Why fixed components:** they guarantee views show only KB content (see kb-visualization), and they are safe in a demo.

### D13. Extraction pipeline
An agent-driven pipeline with three passes:
1. **Inventory:** components, interfaces and data entities, taken from code structure.
2. **Rules:** candidate rules from conditionals, validations and configuration, each with file and line spans.
3. **Documents:** statements from documents, with page or section references.

- The output is validated into a delta. Conflicts with existing claims are recorded as open conflicts.
- Progress events stream to the session, so the explorer view grows live.
- The scorer matches extracted nodes to ground truth by kind plus normalised statement or source location, and reports precision and recall and the planted problems found.

### D14. Sample organization runtime
- Docker Compose runs the services, one Postgres instance with a schema per service, and the legacy ERP. The ERP is written differently on purpose: a single-file service with its own SQLite database and a cron-style nightly job.
- A seed generator produces deterministic history from a fixed random seed.
- `reset` restores database snapshots, the audit log and the KB repository to a tagged starting commit.

### D15. Audit log storage
- An append-only SQLite table owned by `kb-ops`, with one row per call. Raw facts are stored as JSON.
- Rows are never updated. Approvals and outcomes are added as linked rows.
- **Why:** simple and queryable for simulation, with no extra service.
- **Alternative considered:** storing audit records in git. Rejected because of volume and commit noise.

### D16. KB-declared features run on the platform, in one of three modes
Future features are driven by the KB: once a feature is declared there, the platform runs it by **interpreting the declaration, not generating code**. Every System, Component and Action records its mode:

```
  DESCRIBED  modelled and explained, included in impact; not operated
  CONNECTED  governed and operated through bindings; an existing system
             does the work                                   (MVP)
  NATIVE     hosted and run by the platform itself, because no existing
             system does it                                  (future)
```

- Modes can be mixed within one feature. For example, one action step can be bound to an existing payments service while another runs natively.
- An element can move DESCRIBED → CONNECTED → NATIVE. Moving to NATIVE swaps the binding while the KB declaration stays the same, which allows gradual replacement of legacy components. Most elements are expected to stay CONNECTED.
- **Seams the MVP keeps open:**
  - **Binding and step types come from a registry.** REST and SQL are registry entries, not hard-coded executor branches. A future `native` binding type, and step kinds such as emit-event, wait-for-human or call-action, register without executor changes.
  - **DataEntity nodes are fully typed** (fields, types, constraints, identity), so a native runtime can later host what is declared. The schema is strict from the start, because tightening it later would break existing KBs.
  - **The executor treats an action's steps generically.** The MVP implements only binding-call steps, but the step schema has a `kind` discriminator.
- **Why interpretation over generation:** generated code that people then edit drifts from the model, which recreates the problem jig exists to solve. Interpretation keeps the KB as the only definition of behavior, and model-only changes take effect once approved, without a rebuild.
- **Alternatives considered:**
  - A deterministic compiler from the KB to a full software stack. Rejected as the base architecture because it doesn't serve existing landscapes and has a history of drift and expressiveness ceilings. It remains possible later for specific components on the same KB.
  - Hard-coding REST and SQL. Rejected because it closes the NATIVE path.

### D17. Three permission levels, declared in the KB
Every operation and action resolves to one of three levels for the logged-in user:
- **Level 1:** autonomous
- **Level 2:** human-required
- **Level 3:** forbidden

Levels come from KB permission declarations, which state the operation, the user or role, an optional condition and the level. Cedar evaluates them alongside rule policies. The most permissive matching declaration sets the user's level, and matching rules and policies can only raise it (see D7).

```
  user not permitted                    --> 3
  permitted, but a declaration says 2   --> 2  agent may request; a permitted human
                                               (possibly the same user) approves
  permitted, declared 1                 --> 1  agent proceeds
```

- The agent always runs with the logged-in user's permissions, capped at requesting for level 2.
- **For deltas:** a delta the proposer may apply at level 1 is applied straight away and audited. Any other delta waits as `proposed`. The person who approves it needs `kb.approve` and must be able to apply the delta at level 2 or better. That person is often the owner, rather than the proposer, which is how an agent can propose a change that only the owner may make.
- Undeclared operations are level 3.
- The only rules outside the KB are the D8 floors.
- **Why:** one simple model that covers both loops, matches how people think about delegation, and is fully declared in the KB.
- **Alternative considered:** four risk tiers with multi-approver rules. Dropped as more complex than the MVP needs. Conditions on level 2 declarations can add stricter requirements later.

## Risks / Trade-offs

- **[Native hosting makes the platform a production runtime for client features]** → Out of scope for the MVP. Trust is earned on CONNECTED features first. The registry seam means that adding native hosting later is additive.
- **[Agents write Cedar poorly at first]** → Validate every policy against the generated Cedar schema at propose time, include policy examples in agent instructions, and keep rule checks short by pushing logic into CEL derivations.
- **[CEL JavaScript implementations are less mature than cel-go]** → Spike first. The fallback is to run cel-go as a small sidecar behind the same derivation interface.
- **[Cedar datetime is not covered by formal analysis]** → Date arithmetic happens in CEL derivations, so Cedar sees integers such as `days_since_delivery`. This also keeps policies within the analysable subset.
- **[Cedar partial evaluation is experimental]** → Not used in the MVP.
- **[Extraction quality varies live]** → Run the live demo on a pre-chosen subset with a known good benchmark score, and keep the ground-truth KB as the baseline that the demo extends.
- **[Impact traversal floods results in dense graphs]** → Depth limit, per-type weights and collapsed groups in the view, tuned against the planted problems.
- **[Replay is limited to recorded raw facts]** → Report "insufficient facts" explicitly, and record full binding responses rather than selected fields.
- **[The "no refunds in platform" rule erodes under demo pressure]** → A lint check that fails the build on capability-specific identifiers under `platform/`, plus the cancellation acceptance test in CI.
- **[Model latency hurts the demo]** → A Sonnet default, streaming responses, and deterministic computation, not LLM calls, for impact, simulation and decisions.

## Migration Plan

Greenfield, so there is no migration. Demo operations are three commands:
- `up`: start the stack
- `seed`: generate history
- `reset`: return to the tagged starting state

## Open Questions

- The exact numeric thresholds for evidence-based proposals (override rate and window). These are KB configuration and can be tuned during demo rehearsal.
- Visual style of the view catalogue. This is design work that does not change the specs or tasks.
