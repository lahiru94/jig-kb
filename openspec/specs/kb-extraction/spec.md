# kb-extraction Specification

## Purpose

Drafts KB nodes, links and claims from an organization's code and documents using agents, so that a KB can be bootstrapped and extended without manual authoring, with every drafted fact traceable to its source.

## Requirements

### Requirement: Extract from a repository and documents
Given a code repository and a set of documents, extraction SHALL draft candidate nodes (including business rules, components, interfaces and data entities), the links between them, and claims.

#### Scenario: Rule found in code
- **WHEN** extraction runs on the returns service
- **THEN** it drafts a refund window rule with a claim pointing to the code lines that enforce it

### Requirement: Extracted facts carry provenance
Every extracted claim SHALL cite its exact source location and have confidence `inferred`, or `stated` when it was read from a document. Extraction SHALL NOT mark anything `verified`.

#### Scenario: Confidence on extracted claims
- **WHEN** extraction drafts a claim from code
- **THEN** the claim's confidence is inferred and its source is a file and line range

### Requirement: Extraction output is a delta
Extraction SHALL produce a delta for review. It SHALL NOT write to the main KB directly.

#### Scenario: Review extracted nodes
- **WHEN** extraction completes
- **THEN** its results appear as a proposed delta that can be viewed and approved

### Requirement: Conflicts with existing claims are surfaced
When an extracted claim disagrees with an existing claim in the KB, extraction SHALL record an open conflict rather than overwrite the existing claim.

#### Scenario: Code disagrees with policy
- **WHEN** extraction finds a 45-day window for Gold members where the KB states 30 days from the policy document
- **THEN** the delta adds the code claim and an open conflict between the two

### Requirement: Progress is observable
Extraction SHALL report its progress as nodes are drafted, so that a live view can show the model growing.

#### Scenario: Live demo
- **WHEN** extraction runs during a session with the explorer view open
- **THEN** newly drafted nodes appear in the view as they are produced

### Requirement: Extraction is measurable
Extraction results SHALL be comparable against a ground-truth KB, producing precision and recall for rules and links and a list of planted issues found and missed.

#### Scenario: Benchmark run
- **WHEN** extraction is run on the sample organization and scored
- **THEN** a report gives precision and recall for rules and links and names each planted issue as found or missed
