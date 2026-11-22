# Unreleased

- `bj mcp [хавтас]` (PLAN15 F): MCP stdio сервер, SDK-гүй (JSON-RPC 2.0: initialize, ping, tools/list, tools/call; 2025-06-18 / 2025-03-26 / 2024-11-05). 13 ноорогийн хэрэгсэл; apply/deploy/хариулт батлах хэрэгсэлгүй; бичих хил (зам, өргөтгөл, хэмжээ, YAML anchor/alias, хориотой файл, manifest key); агентын хариулт `assumed`; аудит `~/.buteemj/mcp.log`, минутад 120. Стандартын README `src/standard/`-д (sync-validator). `test/mcp.test.js`.
- `bj analyze [--min=…] [--fail-on=…] [--json]` (PLAN15 A6): загварын шинжилгээ — платформын `scripts/analyze` хуулбар (`src/analyzer`, `npm run sync-validator`),
  X0 үнэлэгч `src/analyzer/vendor` (web/src/lib/expr.ts-ээс төрөл хассан). Хуучирсныг `test/analyzer.test.js` барина.

# 0.1.0

- `bj init | validate | status | lint | plan | apply | deploy | pull | server start|stop|status|logs`.
- Validator: платформын `scripts/validate` ба каталогийн хуулбар (`npm run sync-validator`); хуучирсныг `test/validator-sync.test.js` барина (PLAN14 S7).
