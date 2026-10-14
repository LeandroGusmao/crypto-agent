# Project instructions

## Language

- Use English as the default language for all project-authored content: CLI help and output, errors, logs, reports, documentation, prompts, tool and skill descriptions, code comments, identifiers, test descriptions, and commit messages.
- Use English names for new project files and documentation.
- Preserve original external content when storing evidence or quoting a source; write the surrounding explanations and labels in English.
- This convention applies to project artifacts. Follow the user's language in conversation unless they request otherwise.

## Skill chaining

- When using `finishing-a-development-branch`, invoke `finish-with-review-pr` immediately after Step 1 confirms that tests pass and before presenting the integration menu. Its Part A must resolve the repository's architecture-audit findings first.
- When the user selects "Push and Create Pull Request" in that menu, use Part B of `finish-with-review-pr` to build the PR body, including a summary and Mermaid component map, and open the PR as a draft.
