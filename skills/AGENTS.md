# skills/ — Skill Collection

11 skill subdirs for figma-differ. Each subdir contains a `SKILL.md` with YAML frontmatter (`name`, `description`, `triggers`).

## Skills

| Skill | Dir | Role |
|---|---|---|
| `figma-differ:snapshot` | `snapshot/` | Takes a point-in-time snapshot of a Figma node (JSON + PNG) |
| `figma-differ:snapshot-all` | `snapshot-all/` | Snapshots all tracked nodes in bulk |
| `figma-differ:diff` | `diff/` | Diffs current node state against latest snapshot (structural + visual in parallel) |
| `figma-differ:diff-all` | `diff-all/` | Runs diff across all tracked nodes |
| `figma-differ:enrich` | `enrich/` | Enriches thin frames with additional metadata |
| `figma-differ:index` | `index/` | Indexes Figma node structure into the knowledge base |
| `figma-differ:notify` | `notify/` | Posts latest diff result to Slack |
| `figma-differ:review-comments` | `review-comments/` | Fetches and surfaces unresolved Figma file comments grouped by node |
| `figma-differ:search` | `search/` | Searches indexed Figma node data |
| `figma-differ:sync` | `sync/` | Syncs snapshots with current Figma state |
| `figma-differ:track` | `track/` | Tracks a node for recurring diff monitoring |

## SKILL.md Format

```yaml
---
name: figma-differ:<skill-name>
description: One-line summary for skill discovery
triggers:
  - pattern that triggers this skill
---
```

Body: instructions the agent follows. Write artifacts to files, not inline.

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
