# Unreleased

- `bj analyze [--min=…] [--fail-on=…] [--json]` (PLAN15 A6): загварын шинжилгээ — платформын `scripts/analyze` хуулбар (`src/analyzer`, `npm run sync-validator`),
  X0 үнэлэгч `src/analyzer/vendor` (web/src/lib/expr.ts-ээс төрөл хассан). Хуучирсныг `test/analyzer.test.js` барина.

# 0.1.0

- `bj init | validate | status | lint | plan | apply | deploy | pull | server start|stop|status|logs`.
- Validator: платформын `scripts/validate` ба каталогийн хуулбар (`npm run sync-validator`); хуучирсныг `test/validator-sync.test.js` барина (PLAN14 S7).
