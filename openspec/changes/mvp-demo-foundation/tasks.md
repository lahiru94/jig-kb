# Tasks

## 1. Scaffolding

- [x] 1.1 Create the monorepo with the `platform/`, `schema/` and `sample-org/` layout from design D2, a TypeScript workspace config in strict mode, a shared test runner and a `typecheck` script (strict compilation without emitting files, across all packages). Verify `install`, `build`, `typecheck` and `test` all succeed on the empty packages, and that `typecheck` fails on a planted type error.
- [x] 1.2 Add the "capability-agnostic platform" lint check, which fails the build when `platform/` contains capability-specific identifiers such as refund or cancellation, and verify it fails on a planted identifier and passes once it is removed.
- [x] 1.3 Spike CEL JavaScript implementations against the D7 criteria (type-checking, deterministic evaluation, integer and timestamp support), record the choice and the cel-go sidecar fallback in `platform/kb-core/README.md`, and verify with a spike test evaluating three sample derivations.
- [x] 1.4 Add the official Cedar WASM package and verify that a smoke test evaluates a permit and a forbid policy with annotations and reads the matched policy annotations.
- [x] 1.5 Set up CI that runs `typecheck`, `test` and the capability-agnostic lint from 1.2 on every push, and verify that a deliberately broken commit fails the pipeline and a clean commit passes.

## 2. Meta-model, storage and index (kb-model)

- [x] 2.1 Write the LinkML meta-model in `schema/` covering every real-world, digital and operational node kind, the typed links with allowed kind pairs, claims, conflicts and enforcement records, fully typed DataEntity fields and identity, the described, connected or native mode attribute (default described), and the action step `kind` discriminator from D16, and verify that the generated JSON Schema and JSON-LD context build without errors.
- [x] 2.2 Implement the KB loader (Markdown and frontmatter, Cedar and CEL fenced blocks, id and path conventions from D3), and verify unit tests load a fixture KB covering every node kind.
- [x] 2.3 Implement the validator: JSON Schema checks, dangling links, disallowed kind pairs, claim and conflict integrity, claims without a source, Cedar schema validation and CEL type-checking. Verify that one test per kb-model scenario passes, including rejecting an unknown kind and a dangling link.
- [x] 2.4 Implement the in-memory index with forward and reverse adjacency, kind and attribute filters, depth-limited traversal and text search, and verify tests for backlinks and for rebuilding identically from files.
- [x] 2.5 Implement the deterministic RDF projection using the JSON-LD context, and verify that projecting the fixture KB twice gives identical triples.
- [x] 2.6 Add a git pre-commit hook that runs the validator, and verify that an invalid commit is blocked with file, field and schema-version errors.
- [x] 2.7 Document the file conventions and every node kind with an example file in `schema/README.md`, and verify every example in the README passes the validator.

## 3. Sample organization (sample-organization)

- [x] 3.1 Build the storefront, orders, payments, returns, loyalty, tax, notifications and warehouse services with Postgres schemas and Docker Compose, and verify an end-to-end test that places, delivers and fully refunds an order.
- [x] 3.2 Build the legacy ERP in its deliberately different style (single file, SQLite, nightly finance job), and verify the nightly job produces a correct report after a single full refund.
- [x] 3.3 Plant the code-level problems: the 45-day window for Gold members, the undocumented points clawback after a cut-off date, the finance job's one-refund-per-order assumption, and the two definitions of "active customer". Verify a test showing that two partial refunds without the KB make the finance job wrong.
- [x] 3.4 Write the business documents: a refund policy stating 30 days, the loyalty terms, and staff process notes including the manual gift-card reconciliation, with the EU 14-day withdrawal right present only in the policy context. Verify each planted problem is traceable in `sample-org/docs/PLANTED.md`.
- [x] 3.5 Write the deterministic history seed generator (orders, refunds, approval decisions, with frequent overrides of the refund approval limit), and verify that two runs with the same seed produce identical data and an override rate above 80 percent.
- [x] 3.6 Hand-write the ground-truth KB for refunds, including the Action, Binding, Policy and Derivation nodes, and verify it passes the validator and that each planted problem is represented as a rule, conflict, gap or dependency.
- [x] 3.7 Add the order-cancellation capability (service endpoints, documents and KB files) using only KB content on the platform side, and verify the KB files validate.
- [x] 3.8 Implement `up`, `seed` and `reset` commands (database snapshots, audit log and a tagged KB commit), and verify that a test which changes state and then resets returns the systems, data, audit log and KB to the start state.

## 4. Operations surface and guardrail pipeline (kb-operations)

- [x] 4.1 Create the MCP server exposing the query, visualize, propose_delta, analyze_impact, simulate, act and approve tools with typed input and output schemas, and verify an MCP client test lists every tool with its schema.
- [x] 4.2 Implement input validation before execution, including unknown node ids, with structured errors and no side effects, and verify the unknown-id scenario test.
- [x] 4.3 Implement the append-only SQLite audit log from D15, writing one row per call plus linked approval and outcome rows, and verify tests that denied calls are audited and that rows are never updated.
- [x] 4.4 Implement the query operation (kind and attribute filters, traversal from a focus node, text search, provenance and confidence in results), and verify a test querying rules for `capability.returns` against the ground-truth KB.
- [x] 4.5 Implement the engine-neutral `evaluate` interface with the Cedar adapter, entity assembly from action declarations, and decision assembly from `@rule`, `@level` and `@reason` annotations combined with the user's permission declarations (most restrictive wins, undeclared means level 3). Verify unit tests for levels 1, 2 and 3 with plain-language reasons.
- [x] 4.6 Implement the CEL derivation layer that computes derived facts from recorded raw facts, and verify tests that derive `days_since_delivery` deterministically.
- [x] 4.7 Enforce the D8 floors in code before policy evaluation (agents never approve, permission and policy changes are at least level 2, every call audited), and verify that tests pass even when planted KB declarations try to let an agent approve or make permission changes level 1.
- [x] 4.8 Apply per-principal guardrails on every operation call, and verify a test where an operator-role agent calling approve on a delta is denied with reasons.
- [x] 4.9 Document the tool surface and decision format in `platform/kb-ops/README.md`, and verify each documented example call runs in a test.

## 5. Guarded actions (guarded-actions)

- [x] 5.1 Implement the binding-type and step-type registry from D16, with REST and SQL as registered binding types and the binding-call step as the only registered step kind. Verify a test that registers a dummy binding type and runs it without changing the executor core.
- [x] 5.2 Implement the act operation's fact-gathering step through registered bindings, recording raw binding responses in the audit log and rejecting act on actions in described mode. Verify a test against the sample payments and orders services, plus the described-action rejection scenario.
- [x] 5.3 Wire the pipeline end to end (gather, derive, assemble, decide, then execute, queue or stop), and verify a test where the loyalty clawback rule denies a partial refund with no system changed.
- [x] 5.4 Implement the level 2 approval queue with permission checks and override recording, and verify tests where the logged-in approver's approval from a view executes the action and the agent's approve call is denied.
- [x] 5.5 Implement multi-step execution with reverse-order compensation, and verify a test where a failed loyalty step triggers payment compensation and records each step's outcome.
- [x] 5.6 Verify determinism by re-evaluating every recorded audit entry from tests 5.3–5.5 against the same KB version and asserting identical decisions.

## 6. Change governance (change-governance)

- [x] 6.1 Implement deltas as git branches with a delta record, status lifecycle and an overlay index, and verify a test that a draft delta leaves the main KB unchanged and can be read as before and after.
- [x] 6.2 Validate deltas as if applied, blocking proposal when links would break, and verify the broken-link scenario test.
- [x] 6.3 Implement impact analysis (weighted breadth-first traversal over impact-relevant links, path records, risk ranking), and verify a test that a partial-refunds delta reports the clawback rule, the nightly finance job and the notification template, each with its path.
- [x] 6.4 Implement replay simulation over audit windows using the delta's overlay index, including "insufficient facts" reporting, and verify tests for the approval-limit replay counts and for two identical runs giving identical reports.
- [x] 6.5 Govern delta application by permission levels, with the D8 floor raising permission and policy changes to at least level 2. Verify tests where a level 1 wording fix is applied automatically and audited, a level 2 delta waits for a human, and a delta raising agent autonomy still needs human approval even when the KB declares it level 1.
- [x] 6.6 Implement apply as a merge commit recording approvers and the simulation reference, with as-of reads by commit, and verify a test viewing refund rules as of the version before an applied delta.
- [x] 6.7 Implement the evidence evaluator (per-rule override rate over a rolling window, with a KB-configured threshold) that drafts an assigned delta citing the evidence, and verify a test on seeded history that produces the approval-limit proposal.

## 7. Visualization (kb-visualization)

- [x] 7.1 Implement the visualize operation returning view specs (scope resolution for focus and depth, capability, query or delta, view type, overlays, as-of), and verify tests that a depth-2 explorer scope on `capability.returns` returns the expected nodes.
- [x] 7.2 Build the web app shell with the chat pane, the view pane and the WebSocket event channel, and verify a browser test that it loads and connects.
- [x] 7.3 Build the explorer, process flow, rule card, impact ripple and before/after view components from view specs only, and verify component tests that every rendered element carries its KB id and opens its provenance.
- [x] 7.4 Implement the confidence, conflicts, ownership, enforcement and pending-delta overlays, and verify a test that the conflicts overlay marks the refund window rule.
- [x] 7.5 Implement collapsing of large subsets into expandable summary elements, and verify a test with 42 payment rules rendering as one expandable element.
- [x] 7.6 Emit structured interaction events (select, ask, comment, suggest-edit, approve, reject), make saved edits propose draft deltas, and only allow approvals from a view showing before/after and impact or decision reasons. Verify tests for the suggest-edit event and for an edit leaving the main KB unchanged until approval.

## 8. Agent session (agent-session)

- [x] 8.1 Build the session server running the Claude agent through the Agent SDK, with only the kb-ops MCP tools available and a configurable model (`claude-sonnet-5-5` by default), and verify a test that the agent's tool list contains only kb-ops tools.
- [x] 8.2 Implement the working set (views shown and current selection) and its injection into agent context, and verify a test where "why does this exist?" with the clawback rule selected is answered about that rule.
- [x] 8.3 Implement sessions where the agent carries the logged-in user's permissions, capped at requesting for level 2, with role switching and approvals sent from view events directly as the human. Verify tests where an approver's view approval succeeds after switching from operator, and the agent's own approve call is denied in an approver session.
- [x] 8.4 Write agent instructions covering show-or-tell, citing KB nodes, stating when no fact exists, and explaining decisions in plain language. Verify scripted conversation tests for a relationship question (shows a view), a simple fact (text with a source), a missing policy (says so and offers a gap), and a blocked refund (rule, reason and options).

## 9. Extraction (kb-extraction)

- [x] 9.1 Implement the three-pass extraction pipeline (inventory, rules, documents) producing claims with exact sources and confidence inferred or stated, and verify a test on the returns service that drafts the refund window rule with code line references.
- [x] 9.2 Output extraction as a validated delta that records open conflicts against existing claims, and verify the 45-day versus 30-day conflict scenario test.
- [x] 9.3 Stream extraction progress events to the session so the explorer view updates live, and verify a browser test where nodes appear during a run.
- [x] 9.4 Implement the benchmark scorer against the ground-truth KB (precision and recall for rules and links, planted problems found or missed), and verify a benchmark report is produced for the sample organization and its baseline numbers are recorded in `platform/extraction/BENCHMARK.md`.

## 10. Integration

- [x] 10.1 Write an end-to-end test of the full demo cycle on refunds: blocked partial refund, approved exception, evidence-based proposal, impact and replay, human approval of the delta, and successful retry. Verify it passes from a fresh `reset`.
- [x] 10.2 Write the platform acceptance test for order cancellation through act, query, propose_delta, analyze_impact and simulate with no platform code changes, and verify it passes in CI together with the lint check from 1.2.
- [ ] 10.3 Write the demo runbook in `docs/demo.md` (setup, the five-minute script, live extraction subset, reset), and verify a full rehearsal run following it exactly.
