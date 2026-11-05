# jig KB schema

This directory holds the meta-model for the jig knowledge base (KB).
- `jig.yaml` is the LinkML source of truth, versioned in its `version` field.
- `generated/` holds the JSON Schema and JSON-LD context built from it with `npm run schema:build`.

## File conventions

- **One node per file:** each node is a Markdown file. Structured facts go in YAML frontmatter and narrative goes in the body.
- **Ids:** a node's id is `<prefix>.<slug>`, for example `rule.refund-window`. The id is stable: renaming or moving the file does not change it.
- **Folders:** files live in `<kind folder>/<slug>.md`, for example `rules/refund-window.md`.
- **Prefixes and folders:**

  | Kind | Prefix | Folder |
  |---|---|---|
  | Goal | `goal` | `goals/` |
  | Constraint | `constraint` | `constraints/` |
  | Capability | `capability` | `capabilities/` |
  | Process | `process` | `processes/` |
  | Step | `step` | `steps/` |
  | BusinessRule | `rule` | `rules/` |
  | Term | `term` | `terms/` |
  | Actor | `actor` | `actors/` |
  | Role | `role` | `roles/` |
  | Decision | `decision` | `decisions/` |
  | System | `system` | `systems/` |
  | Component | `component` | `components/` |
  | Interface | `interface` | `interfaces/` |
  | DataEntity | `entity` | `entities/` |
  | Job | `job` | `jobs/` |
  | Agent | `agent` | `agents/` |
  | Action | `action` | `actions/` |
  | Binding | `binding` | `bindings/` |
  | Derivation | `derivation` | `derivations/` |
  | Policy | `policy` | `policies/` |
  | Permission | `permission` | `permissions/` |

- **Key names:** frontmatter keys are kebab-case (`implemented-by`) and map to the snake_case slots in `jig.yaml`. Keys inside free-form maps (`config`, `with`) are kept as written.
- **Links:** link fields hold node ids. Each link type allows only certain source and target kinds, as recorded in the `targets` annotation of each link slot in `jig.yaml`. The validator rejects links to missing nodes and links between disallowed kinds.
- **Executable content:** Cedar policies go in ```cedar blocks in the body (BusinessRule checks and Policy nodes). CEL expressions go in ```cel blocks (Derivations). Cedar is validated against a Cedar schema built from the KB, and CEL is type-checked against the derivation's inputs.
- **Claims:** a claim records `says`, a `source` (`code:`, `doc:`, `person:`, `meeting:` or `system:`) and a `confidence` (`inferred`, `stated` or `verified`). A claim without a source is invalid.
- **Conflicts:** a conflict refers to claims by index. A resolved conflict must name the chosen claim and who resolved it.
- **KB root marker:** a directory is a KB root when it contains a `.jigkb` marker file. `npm run kb:validate` validates every KB root, and the pre-commit hook (installed with `npm run hooks:install`) validates the staged contents.

## Node kinds

The examples below form one small, valid KB. A test (`platform/kb-core/test/schema-readme.test.ts`) extracts and validates them.

### Real-world kinds

#### Goal

An outcome the organization wants.

File `goals/fast-fulfilment.md`:

````markdown
---
id: goal.fast-fulfilment
kind: Goal
title: Fulfil orders within two days
owned-by: [role.ops-lead]
---
Customers should receive orders quickly.
````

#### Constraint

A regulation, policy or other external constraint. `statement` gives it in plain language.

File `constraints/consumer-law.md`:

````markdown
---
id: constraint.consumer-law
kind: Constraint
title: Consumer protection law
statement: Customers may withdraw from distance purchases within 14 days.
---
````

#### Capability

Something the business does, such as ordering or refunds.

File `capabilities/ordering.md`:

````markdown
---
id: capability.ordering
kind: Capability
title: Ordering
owned-by: [role.ops-lead]
implemented-by: [system.shop]
---
Taking and fulfilling customer orders.
````

#### Process

How a capability is carried out. Links to the jobs, components or actions that realize it.

File `processes/order-handling.md`:

````markdown
---
id: process.order-handling
kind: Process
title: Order handling
part-of: [capability.ordering]
realized-by: [job.nightly-report]
---
````

#### Step

One step of a process.

File `steps/approve-order.md`:

````markdown
---
id: step.approve-order
kind: Step
title: Approve large orders
part-of: [process.order-handling]
implemented-by: [action.place-order]
---
````

#### BusinessRule

The atomic unit of the KB. `statement` is required and is the plain-language rule. `enforcement` records where it is enforced (the KB layer and/or named components). An optional executable check is a Cedar policy in a ```cedar block, annotated with `@rule`, `@level` and `@reason`. Claims and conflicts record what different sources say. `override-threshold` configures evidence-based proposals.

File `rules/order-limit.md`:

````markdown
---
id: rule.order-limit
kind: BusinessRule
title: Order limit
statement: Orders above 1000 need manager approval.
part-of: [capability.ordering]
implemented-by: [component.order-service]
enforced-on: [action.place-order]
uses: [derivation.order-total]
governed-by: [constraint.consumer-law]
decided-by: [decision.2024-order-limit]
owned-by: [role.ops-lead]
enforcement:
  kb-layer: true
  components: [component.order-service]
override-threshold:
  rate: 0.8
  window-days: 7
  min-samples: 10
claims:
  - says: Orders above 1000 need approval
    source: doc:policies/ordering.md#limits
    confidence: stated
  - says: Orders above 1500 need approval
    source: code:order-service/src/limits.ts#L10-L14
    confidence: inferred
conflicts:
  - about: approval threshold
    claims: [0, 1]
    status: open
---
## Why
Large orders carry fraud risk.

```cedar
@rule("rule.order-limit")
@level("2")
@reason("Orders above 1000 need manager approval.")
forbid (principal, action == Action::"action.place-order", resource)
when { context.order_total > 1000 };
```
````

#### Term

A business term with its definition and the data entities it defines.

File `terms/active-customer.md`:

````markdown
---
id: term.active-customer
kind: Term
title: Active customer
definition: A customer with an order in the last 12 months.
defines: [entity.order]
---
````

#### Actor

A person or team. Session users are Actors, with the roles they hold.

File `actors/sam.md`:

````markdown
---
id: actor.sam
kind: Actor
title: Sam (operations lead)
roles: [role.ops-lead]
---
````

#### Role

A role that owns nodes and is granted permissions.

File `roles/ops-lead.md`:

````markdown
---
id: role.ops-lead
kind: Role
title: Operations lead
---
````

#### Decision

A recorded decision and why it was made, in ADR style.

File `decisions/2024-order-limit.md`:

````markdown
---
id: decision.2024-order-limit
kind: Decision
title: Introduce an order approval limit
status: accepted
decided-at: 2024-03-01
---
````

### Digital kinds

#### System

A system. `mode` is `described`, `connected` or `native` (default `described`).

File `systems/shop.md`:

````markdown
---
id: system.shop
kind: System
title: Shop platform
mode: connected
---
````

#### Component

A part of a system, such as a service. Has a `mode`.

File `components/order-service.md`:

````markdown
---
id: component.order-service
kind: Component
title: Order service
mode: connected
part-of: [system.shop]
notifies: [interface.order-email]
---
````

#### Interface

An API, event, file or message, such as a customer email template.

File `interfaces/order-email.md`:

````markdown
---
id: interface.order-email
kind: Interface
title: Order confirmation email
part-of: [component.order-service]
---
````

#### DataEntity

A data entity. Every field has a type. `identity` lists the fields that identify an instance.

File `entities/order.md`:

````markdown
---
id: entity.order
kind: DataEntity
title: Order
part-of: [component.order-service]
identity: [order_id]
fields:
  - name: order_id
    type: string
    required: true
  - name: total
    type: decimal
    min: 0
  - name: status
    type: enum
    values: [placed, shipped, delivered]
  - name: placed_at
    type: timestamp
---
````

#### Job

A scheduled or batch job.

File `jobs/nightly-report.md`:

````markdown
---
id: job.nightly-report
kind: Job
title: Nightly order report
part-of: [system.shop]
depends-on: [entity.order]
---
````

#### Agent

An AI agent known to the organization.

File `agents/order-assistant.md`:

````markdown
---
id: agent.order-assistant
kind: Agent
title: Order assistant
roles: [role.ops-lead]
---
````

### Operational kinds

#### Action

A typed business operation agents can request. `inputs` are typed. `facts` are gathered from bindings or derivations before evaluation. `steps` run in order, each with an optional `compensate` step. Has a `mode`, and only `connected` or `native` actions can be run.

File `actions/place-order.md`:

````markdown
---
id: action.place-order
kind: Action
title: Place an order
mode: connected
part-of: [capability.ordering]
resource: entity.order
inputs:
  - name: order_id
    type: string
    required: true
facts:
  - name: order_total
    type: int
    binding: binding.get-order
    with: {order_id: $input.order_id}
    path: total
steps:
  - name: submit
    kind: binding-call
    binding: binding.submit-order
    with: {order_id: $input.order_id}
    compensate:
      binding: binding.cancel-submission
      with: {order_id: $input.order_id}
---
````

#### Binding

How a fact or step reaches a real system. `binding-type` names a registered type (`rest`, `sql`), and `config` is type-specific.

File `bindings/get-order.md`:

````markdown
---
id: binding.get-order
kind: Binding
title: Read an order
binding-type: rest
binds-to: [component.order-service]
config:
  method: GET
  url: http://localhost:4100/orders/{order_id}
---
````

#### Derivation

A computed fact. The CEL expression goes in a ```cel block and is type-checked against the declared `inputs`.

File `derivations/order-total.md`:

````markdown
---
id: derivation.order-total
kind: Derivation
title: Order total with tax
output-type: decimal
inputs:
  - name: subtotal
    type: decimal
  - name: tax
    type: decimal
---
```cel
subtotal + tax
```
````

#### Policy

A Cedar policy not tied to one rule, in a ```cedar block.

File `policies/ops-only.md`:

````markdown
---
id: policy.ops-only
kind: Policy
title: Only operations staff place orders
enforced-on: [action.place-order]
---
```cedar
@level("3")
@reason("Only operations staff may place orders.")
forbid (principal, action == Action::"action.place-order", resource)
unless { principal in Role::"role.ops-lead" };
```
````

#### Permission

A permission declaration: the operation (an action id or a KB operation such as `kb.approve`), the roles it applies to, an optional Cedar `condition`, and a `level`: 1 means autonomous, 2 means a permitted human must approve or do it, 3 means forbidden. Operations with no declaration are level 3.

File `permissions/ops-place-order.md`:

````markdown
---
id: permission.ops-place-order
kind: Permission
title: Operations leads may place orders
operation: action.place-order
roles: [role.ops-lead]
level: 1
condition: context.order_total <= 1000
---
````

### Supporting examples

The bindings the Action example refers to:

File `bindings/submit-order.md`:

````markdown
---
id: binding.submit-order
kind: Binding
title: Submit an order
binding-type: sql
binds-to: [entity.order]
config:
  query: UPDATE orders SET status = 'placed' WHERE order_id = $1
  params: [order_id]
---
````

File `bindings/cancel-submission.md`:

````markdown
---
id: binding.cancel-submission
kind: Binding
title: Undo an order submission
binding-type: sql
binds-to: [entity.order]
config:
  query: UPDATE orders SET status = 'draft' WHERE order_id = $1
  params: [order_id]
---
````

