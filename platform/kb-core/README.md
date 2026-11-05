# @jig/kb-core

Schema, loader, validator, index and projection for the jig knowledge base (design D3–D5).

## CEL library choice (task 1.3)

Derivations (design D7) are written in CEL. We evaluated three JavaScript implementations against the D7 criteria: static type-checking, deterministic evaluation, and integer and timestamp support.

| Library | Type-checking | Deterministic | int / timestamp | Notes |
|---|---|---|---|---|
| **`@marcbachmann/cel-js` 8.0.0** | Yes: `Environment.check()` against declared variable types, rejects undeclared variables | Yes: no ambient clock (`now()` does not type-check), pure evaluation over supplied facts | `int` as `bigint`, `google.protobuf.Timestamp` and `Duration` with accessor methods | MIT, zero dependencies |
| `@bufbuild/cel` 0.6.1 | Yes | Yes | Yes | Apache-2.0. Pre-1.0, and built around protobuf descriptors, which jig doesn't use |
| `cel-js` 0.8.2 | No: only `parse` and `evaluate` | Yes | Partial | Rejected: no type-checking |

**Choice: `@marcbachmann/cel-js`.** It meets all three criteria, has no dependencies, and its `Environment` API matches the way derivations declare their input facts.

Rules for using it in jig:
- Every derivation runs in an `Environment` that registers its declared input facts with types. Undeclared variables are rejected by `check()`.
- Never register impure functions, such as clock reads, random values or I/O. The evaluation time is passed in as a recorded fact (for example `evaluated_at`), so replay gives identical results.
- Async function handlers are never registered.

**Fallback:** if the library falls short on a CEL feature we need, run `cel-go` as a small sidecar behind the same derivation interface. Callers only see `derive(expression, facts)`, so swapping implementations doesn't affect the rest of the platform.

The spike is in `test/cel-spike.test.ts`.
