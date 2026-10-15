# Project instructions

## Language

- Use English as the default language for all project-authored content: CLI help and output, errors, logs, reports, documentation, prompts, tool and skill descriptions, code comments, identifiers, test descriptions, and commit messages.
- Use English names for new project files and documentation.
- Preserve original external content when storing evidence or quoting a source; write the surrounding explanations and labels in English.
- This convention applies to project artifacts. Follow the user's language in conversation unless they request otherwise.

## Architecture document

- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code structure.
- Update it in the same change whenever you add or move a module or layer, change a contract in `src/paper/types.ts`, add a schema migration, add an unfilled reason code, or change an invariant it lists. Add notable decisions to its decision log and refresh its "Last updated" line.
- Describe only what the code does; mark anything not yet implemented as planned.

## Skill chaining

- When using `finishing-a-development-branch`, invoke `finish-with-review-pr` immediately after Step 1 confirms that tests pass and before presenting the integration menu. Its Part A must resolve the repository's architecture-audit findings first.
- When the user selects "Push and Create Pull Request" in that menu, use Part B of `finish-with-review-pr` to build the PR body, including a summary and Mermaid component map, and open the PR as a draft.
