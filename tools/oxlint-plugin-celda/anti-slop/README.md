# Vendored anti-slop rules

Source: `dmmulroy/anti-slop` commit `e8c4880` (v0.1.2).

Only the runtime plugin sources are vendored; upstream's tests and agent skill
are intentionally excluded. Celda enables every vendored rule from
`vite.config.ts`, including the optional Effect rule.

Local changes:

- `shared/dictionary-types.ts` handles an empty indexed lookup explicitly because
  Celda compiles with `noUncheckedIndexedAccess`.
- `rules/no-shape-in-symbol-names.ts` is not vendored: it bans the English word
  "shape" in symbol names, and Celda names its symbols in Spanish.
- `isPopulatedObjectExpression` is not vendored in `shared/dictionary-types.ts`:
  no rule calls it.
- `rules/no-module-mocking.ts` also recognises `vi` imported from
  `@effect/vitest`, which re-exports Vitest's `vi` and is where Celda's tests
  import it from. Upstream only recognises `vitest`.
