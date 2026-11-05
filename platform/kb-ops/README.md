# @jig/kb-ops

The operations agents use to read, change and act on the KB, served over MCP (design D12, kb-operations spec). Every call is:

1. **validated** before anything happens. Invalid calls fail with a structured error and have no side effects;
2. **checked against guardrails** for the calling principal: the signed-in user, and whether an agent is acting for them;
3. **audited** in the append-only audit log, whether it succeeds, is denied or is invalid.

`createKbMcpServer(service, principal)` exposes the operations as MCP tools for one principal. `KbService` implements them.

## Principals

A principal is `{ user, viaAgent }`. `user` is an Actor id from the KB, such as `actor.casey`, and `viaAgent` is true when an agent is calling for that user. Agents get the user's permissions, but they can only *request* level-2 operations and can never approve anything (design D8, D17).

## Decisions

Whenever a call is held or refused, the result includes a decision:

```ts
{
  level: 1 | 2 | 3,          // 1 allowed, 2 needs a person's approval, 3 forbidden
  reasons: Array<{
    source: string,          // the rule, policy or permission id (or a platform floor)
    kind: "rule" | "policy" | "permission" | "floor" | "default",
    level: 1 | 2 | 3,
    reason: string,          // plain-language reason
    statement?: string       // for rules: the rule's statement
  }>
}
```

Levels come from Permission declarations in the KB. The most permissive matching declaration sets the user's level, and operations with no declaration are level 3. Matching rules and policies then raise the level. Three floors are enforced in code: agents never approve, permission and policy changes are at least level 2, and every call is audited.

## Errors

Operation errors come back as MCP tool errors with this body:

```json
{ "error": { "code": "unknown_node", "message": "unknown node 'rule.ghost' in 'focus'", "id": "rule.ghost", "field": "focus" } }
```

Codes: `invalid_input`, `unknown_node`, `not_operable`, `denied`, `not_found`, `conflict`, `failed`.

## Tools

Each example below runs in `test/readme.test.ts` against the sample KB, so it stays correct.

### query

Find nodes by kind, attributes, links from a focus node, or text. Every result includes its claims, conflicts and confidence.

<!-- example: actor.casey via agent -->
```json
{ "tool": "query", "input": { "focus": "capability.returns", "direction": "in", "link_types": ["part-of"], "kind": "BusinessRule" } }
```

### visualize

Render a view of a KB subset as a view spec. The views are `explorer`, `process`, `rule-card`, `impact` and `before-after`. The overlays are `confidence`, `conflicts`, `ownership`, `enforcement` and `pending-delta`.

<!-- example: actor.casey via agent -->
```json
{ "tool": "visualize", "input": { "scope": { "focus": "rule.refund-window" }, "view": "rule-card" } }
```

### propose_delta

Create or update a draft delta. With `"propose": true` the delta is validated as if applied, then either applied at once (level 1) or left waiting for a person (`proposed`).

<!-- example: actor.casey via agent -->
```json
{ "tool": "propose_delta", "input": { "title": "Raise the approval limit", "rationale": "Supervisors approve almost all of these", "changes": [{ "op": "modify", "id": "rule.refund-approval-limit", "content": "$file(rules/refund-approval-limit.md, 50000, 80000)" }] } }
```

### analyze_impact

List every node a delta could affect, with the link path from the change and a risk rank.

<!-- example: actor.casey via agent -->
```json
{ "tool": "analyze_impact", "input": { "delta_id": "$delta" } }
```

### simulate

Replay recorded action requests against the KB before and after a delta, and report how decisions would change.

<!-- example: actor.casey via agent -->
```json
{ "tool": "simulate", "input": { "delta_id": "$delta", "window_days": 30 } }
```

### act

Request a business action. Facts are gathered through bindings, then the request is decided: level 1 runs now, level 2 is queued for a person, level 3 is refused.

<!-- example: actor.casey via agent -->
```json
{ "tool": "act", "input": { "action": "action.issue-refund", "inputs": { "order_id": "ord-1", "amount_cents": 80000 } } }
```

### approve

A person approves or rejects a queued request or a proposed delta. Agents calling this are always refused.

<!-- example: actor.morgan in person -->
```json
{ "tool": "approve", "input": { "request_id": "$request", "approve": true } }
```
