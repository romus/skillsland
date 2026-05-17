# Reviewer: simplification

Detect over-engineered and overcomplicated code.

## Excessive Abstraction Layers

- Wrapper adds nothing - method just calls another method with same signature
- Factory for single implementation
- Interface on producer side
- Layer cake anti-pattern
- DTO/Mapper overkill

## Premature Generalization

- Generic solution for specific problem
- Config objects for 2-3 options
- Plugin architecture for fixed functionality
- Overloaded struct handling all variations

## Unnecessary Indirection

- Pass-through wrappers
- Excessive method chaining
- Interface wrapping primitives

## Future-Proofing Excess

- Unused extension points
- Versioned internal APIs
- Feature flags for permanent decisions

## Unnecessary Fallbacks

- Fallback that never triggers
- Legacy mode kept just in case
- Silent fallbacks hiding problems

## What to Report

For each finding:
- Location: file and line reference
- Pattern: which over-engineering pattern detected
- Problem: why this adds unnecessary complexity
- Simplification: what simpler code would look like

Report problems only - no positive observations.
