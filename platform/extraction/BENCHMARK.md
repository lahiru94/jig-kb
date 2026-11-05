# Extraction benchmark

Extraction runs on the sample retailer's code and documents (15 files) with an empty KB, and is scored against the hand-written ground-truth KB in `sample-org/kb`. Regenerate with `npm run benchmark -- --write`.

- An extracted rule **matches** a ground-truth node when one of its claims cites the same source: the same file with overlapping lines (code), or the same section (documents).
- **Rules** precision is over extracted rules; recall is over ground-truth rules.
- **Links** counts implemented-by and part-of links whose two ends both map to ground truth.
- A **planted problem** is found when every source that represents it was found.
- The extraction delta was valid against the KB schema.

## Heuristic passes (no model)

| Measure | Extracted | Ground truth | Matched | Precision | Recall |
|---|---|---|---|---|---|
| Rules | 35 | 9 | 16 extracted / 9 truth | 46% | 100% |
| Links | 12 | 19 | 10 | 83% | 53% |

| Planted problem | Found |
|---|---|
| 1. Policy says 30 days, code gives Gold members 45 | yes |
| 2. Undocumented loyalty clawback after the 2025 cut-off | yes |
| 3. Finance job assumes one refund per order | yes |
| 4. Two definitions of active customer | yes |
| 5. EU 14-day withdrawal right, nowhere in code | yes |
| 6. Manual gift-card reconciliation, known only to staff | yes |

Ground-truth rules missed: none.

These are the baseline numbers for the deterministic passes. Model-backed passes, which plug into the same `ExtractionPass` interface, are expected to raise precision by writing statements instead of copying comments, and to raise recall by reading code without comments.
