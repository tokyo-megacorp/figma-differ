# agents/ — Agent Definitions

2 agent definitions for figma-differ diff operations. Each agent is a Markdown file with YAML frontmatter (`name`, `description`).

## Agents

| Agent | File | Role |
|---|---|---|
| `structural-differ` | `structural-differ.md` | Compares two Figma node JSON snapshots — identifies added/removed/changed nodes with field-level precision |
| `vision-analyzer` | `vision-analyzer.md` | Compares two PNGs via Claude vision — produces fidelity score (1–5) and categorized findings |

## Dispatch Contract

Both agents are spawned **in parallel** by the `/figma-differ:diff` skill:
1. `structural-differ` receives: `baseline node.json` + `current node.json`
2. `vision-analyzer` receives: `baseline screenshot.png` + `current screenshot.png`
3. Results are merged by the orchestrating diff skill into `latest-diff.md`

Adding a new agent: create `agents/<name>.md` with `name:` + `description:` frontmatter and update the root AGENTS.md index.

## Local Role

TODO: Fill in this local contract section.

## Product Vision Fit

TODO: Fill in this local contract section.

## Tech Stack Boundaries

TODO: Fill in this local contract section.

## Owns

TODO: Fill in this local contract section.

## Does Not Own

TODO: Fill in this local contract section.

## Routes Elsewhere

TODO: Fill in this local contract section.

## Local Examples

TODO: Fill in this local contract section.

## Verification

TODO: Fill in this local contract section.

## Change Triggers

TODO: Fill in this local contract section.
