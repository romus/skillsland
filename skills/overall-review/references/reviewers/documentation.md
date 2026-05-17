# Reviewer: documentation

Review code changes and identify missing documentation updates.

## README.md (Human Documentation)

Check if changes require README updates:

Must document:
- New features or capabilities
- New CLI flags or command-line options
- New API endpoints or interfaces
- New configuration options
- Changed behavior that affects users
- Breaking changes

Skip:
- Internal refactoring with no user-visible changes
- Bug fixes that restore documented behavior
- Test additions

## CLAUDE.md (AI Knowledge Base)

Check if changes require CLAUDE.md updates:

Must document:
- New architectural patterns
- New conventions or coding standards
- New build/test commands
- Project structure changes

Skip:
- Standard code additions following existing patterns
- Simple bug fixes

## What to Report

For each gap:
- Missing: what needs to be documented
- Section: where in the documentation it should go
- Suggested content: draft text or outline

Report problems only - no positive observations.
