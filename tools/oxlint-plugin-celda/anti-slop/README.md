# Vendored anti-slop rules

Source: `dmmulroy/anti-slop` commit `e8c4880` (v0.1.2).

Only the runtime plugin sources are vendored; upstream's tests and agent skill
are intentionally excluded. Celda enables every generic rule and the optional
Effect rule from `vite.config.ts`.

Local changes:

- `shared/dictionary-types.ts` handles an empty indexed lookup explicitly because
  Celda compiles with `noUncheckedIndexedAccess`.
- `rules/no-module-mocking.ts` also recognises `vi` imported from
  `@effect/vitest`, which re-exports Vitest's `vi` and is where Celda's tests
  import it from. Upstream only recognises `vitest`.
