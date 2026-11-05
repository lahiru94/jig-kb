# jig demo runbook

A five-minute demo for a non-technical audience. It shows the whole cycle on one capability, refunds at Brightmere Goods (a fictional retailer):

1. An agent tries a refund.
2. A rule holds it.
3. A person approves the exception.
4. jig notices the pattern and proposes a rule change.
5. The impact and a replay of past refunds show what the change would do.
6. The owner approves the change.
7. The next refund goes straight through.

## Setup (once, about 5 minutes)

You need Node 22, Docker Desktop (running) and, for the conversational agent, an Anthropic API key.

```bash
npm ci
```

```bash
npm run demo -- up
```

`up` builds and starts the retailer's nine services and Postgres (port 54329), then seeds 120 customers, 800 orders and their refund history. It also creates jig's runtime: a git repository for the KB, tagged `demo-start`, and an audit log containing the history.

Put your Anthropic API key in `.env` at the repository root. Copy `.env.example` if `.env` doesn't exist yet. The key is optional: without it the agent is off, but views, approvals and extraction still work. `.env` is git-ignored.

```
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run demo -- start
```

Open http://localhost:4300. Check that the header shows **Connected** and **Signed in as Casey (customer service agent)**.

## The five-minute script

| Time | You say or do | What the audience sees |
|---|---|---|
| 0:00 | "Brightmere is a mid-size retailer. Casey works in customer service. jig is the assistant Casey talks to, and everything it knows is in the knowledge base." Type: **Show me how refunds work.** | A process view of refunds: the steps, the rules on each, and the systems behind them. |
| 0:40 | Turn on conflicts (or ask **Where do our sources disagree?**). Click **Refund window**. | The rule card: the policy says 30 days, but the code gives Gold members 45. jig shows both sources and doesn't pick a side. |
| 1:20 | Type: **A customer's kayak arrived damaged. Refund $600 of order ord-demo.** | An approval card: held by the loyalty clawback rule (found only in code: a partial refund takes back *all* the order's points) and by the $500 approval limit. jig explains both in plain language. |
| 2:00 | Switch **Signed in as** to Morgan (supervisor). Click **Approve** on the card. | The refund runs across payments, loyalty, the ERP and email. The audit log records Morgan's approval as an override. |
| 2:30 | "Supervisors approve nearly every refund over $500." Switch to Alex (Head of Customer Service). Type: **Any rules we should review?** | jig has drafted a proposal from the evidence: in 90 days, people approved over 90% of the refunds the $500 limit held. It is assigned to Alex. |
| 3:10 | Type: **Draft raising it to $800 and show me what it touches.** | The impact view. The change ripples to the refund action, the one-refund-per-order rule and the **nightly finance job** in the legacy ERP, which jig doesn't operate but knows about. |
| 3:50 | Type: **What would that have done last quarter?** | The replay: how many past refunds would have gone through without approval, with examples. Nothing is guessed: it re-runs the recorded facts. |
| 4:20 | Open the before/after view and click **Approve change**. | The rule changes, as a reviewed, versioned commit that records Alex as approver and the simulation. |
| 4:40 | Switch back to Casey. Type: **Refund order ord-demo-2 in full.** | A $750 refund goes straight through: the rule the business actually works by is now the one jig enforces. |

To prepare `ord-demo` and `ord-demo-2` before the demo, run the "full demo cycle" stack test once, then `reset`. Or create the orders through the storefront:

```bash
curl -s -XPOST localhost:4101/signup -H 'content-type: application/json' -d '{"customer_id":"cus-demo","name":"Demo Customer","email":"demo@example.com","region":"us"}'
```

```bash
curl -s -XPOST localhost:4101/checkout -H 'content-type: application/json' -d '{"customer_id":"cus-demo","order_id":"ord-demo","lines":[{"sku":"KAYAK-1P","qty":1,"price_cents":89900}]}'
```

```bash
curl -s -XPOST localhost:4108/shipments/ord-demo/deliver -H 'content-type: application/json' -d '{}'
```

Repeat the last two commands with `ord-demo-2` and `{"sku":"PADDLEBOARD","qty":1,"price_cents":69900}`.

## Live extraction (optional, 1 minute)

To show that the KB isn't hand-built, click **Run extraction** in the header. jig reads the returns and loyalty services and the policy documents, and the explorer view fills in pass by pass:
- **Inventory:** components and data entities.
- **Rules:** rules found in code, each citing exact line numbers.
- **Documents:** statements from the policies, cited by section.

Claims from code are marked **Inferred**. Where code disagrees with a document, a **Conflict** appears. The result is a draft change for review, and the KB doesn't change.

The subset is chosen to be fast and to land on the planted problems. Baseline scores are in `platform/extraction/BENCHMARK.md`.

## Reset (between rehearsals)

```bash
npm run demo -- reset
```

`reset` restores the service databases from their snapshot, reloads the ERP postings, and recreates the KB repository at `demo-start` along with a fresh audit log containing the seeded history. Restart `npm run demo -- start` afterwards.

## Shut down

```bash
npm run demo -- down
```

## Without Docker

`npm run demo -- init` then `npm run demo -- start` runs jig on its own. Views, the rule card, impact, before/after, approvals of KB changes and live extraction all work. Refunds and cancellations fail, because there are no systems to reach.
