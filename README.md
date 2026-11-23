# Бүтээмж CLI (`bj`)

Бизнес шинжээч (BA), Системийн архитектор (SA) болон шийдэл хөгжүүлэгчдэд зориулсан **BRD+PRD багцын бие даасан хөгжүүлэлтийн туслах хэрэгсэл**.

Энэхүү CLI нь платформын дотоод эх кодтой хутгалдахгүйгээр дурын төслийн хавтаснаас Бүтээмжийн загварыг шалгах, migration plan тооцоолох, өгөгдлийн санд хэрэгжүүлэх боломжийг олгоно.

---

## Суулгах

```bash
# Глобалаар холбох (хөгжүүлэлтийн үед)
npm link

# Эсвэл NPM-ээр суулгах
npm install -g @buteemj/cli
```

Суусан эсэхийг шалгах:
```bash
bj --version
bj --help
```

---

## Үндсэн командуудын хэрэглээ

### 1. Шинэ төсөл үүсгэх (`init`)
Цоо шинэ BRD+PRD багцын стандарт бүтэцтэй хавтсыг үүсгэнэ:
```bash
bj init my-retail-system
cd my-retail-system
```
Үүсэх файлууд:
* `manifest.yaml` — Төслийн мета өгөгдөл
* `requirements.md` — Шаардлагуудын хүснэгт
* `erd.dbml` — Өгөгдлийн сангийн хүснэгт, баганууд
* `states.mmd` — Төлөвийн шилжилтийн диаграм
* `screens.yaml` — Дэлгэц, UI талбарууд
* `roles.csv` — Хандлагын эрхийн тохиргоо

### 2. Загваруудыг локалд шалгах (`validate`)
Сервергүйгээр файл хоорондын уялдаа (ERD ↔ States ↔ Screens ↔ Requirements)-г шалгана:
```bash
bj validate
```

#### Загварын шинжилгээ (`analyze`)
Багц зөв бичигдсэн ч утга зүйн хувьд бүрэн, зөрчилгүй эсэхийг сервергүй, LLM-гүй шалгана: хүрэх боломжгүй төлөв, эрхгүй шилжилт,
DMN-ийн давхцал/цоорхой, enum-ийн буруу утга, хэзээ ч биелэхгүй нөхцөл, маягтад гараагүй заавал талбар, шаардлагаар лавлагдаагүй элемент.
Олдвор анхдагчаар зөвлөмж (гаралтын код 0); `--fail-on`-оор хаалт болгоно. Дүрэм: платформын `scripts/analyze/README.md`.
```bash
bj analyze
```
```bash
bj analyze --min=important --fail-on=blocking
```

### 3. Серверийн төлөвийг шалгах (`status`)
Бүтээмжийн серверийн холболт хэвийн байгаа эсэхийг шалгана:
```bash
bj status
bj status --url http://localhost:8080
```

### 4. Хуурай шалгалт хийх (`lint`)
Сервер рүү илгээж бодит гүйлгээний (rollback) орчинд загварын зөрчил байгаа эсэхийг хуурай шалгана:
```bash
bj lint
```

### 5. Migration Plan тооцоолох (`plan`)
Өгөгдлийн сангийн бодит бүтэцтэй тулган харьцуулж, ямар DDL өөрчлөлт орох төлөвлөгөөг гаргана:
```bash
bj plan
```
*(Үр дүн `.bj/<key>.plan.json` файлд хадгалагдана)*

### 6. Өгөгдлийн санд хэрэгжүүлэх (`apply`)
Хянаж баталгаажуулсан төлөвлөгөөг бодит өгөгдлийн санд DDL migration болгон автоматаар суулгана:
```bash
bj apply
```

### 7. Нэг тушаалаар бүтээх (`deploy`)
Шалгах -> Plan гаргах -> Өгөгдлийн санд хэрэгжүүлэх үйлдлийг нэг тушаалаар хийнэ:
```bash
bj deploy
```

### 8. Серверээс татах (`pull`)
Сервер дээрх хэрэгжсэн багцын файлуудыг локал хавтсандаа татаж авна:
```bash
bj pull
```

---

### 9. Локал сервер (`server`) — C++ эх код хэрэггүй
Бэлэн Docker image-ээс (`buteemj-platform-{cgi,worker,web,migrate}`) postgres + pgbouncer + cgi + worker + web-ийг асаана:
```bash
bj server start                 # анхдагч http://localhost:8080 (зөвхөн 127.0.0.1); --port 18090 --project buteemj
bj server status                # сервисүүд + /api/health
bj server logs migrate --follow # логи (--tail 200)
bj server stop                  # зогсооно, өгөгдөл хадгална;  --purge = volume + .env устгана
```
* Тохиргоо `~/.buteemj/server/` (`--dir`, `BUTEEMJ_HOME`): `compose.yml` (= `platform/docker/compose.dist.yml`) ба `.env` (0600) — анхны асалтад санамсаргүй DB/JWT/админ нууц үг үүсгэнэ.
* Анхны асалтад цөмийн схем автоматаар ачаалагдаж, админ `admin` үүснэ; нууц үгийг ганц удаа хэвлэнэ (дараа нь `.env` → `BJ_ADMIN_PASSWORD`), анхны нэвтрэлтэд солиулна.
* Image: `BUTEEMJ_REGISTRY` / `--registry` заасан бол `docker compose pull`, үгүй бол локал image (`platform/scripts/build-dist-images.sh`).
* **Нууц үгийн анхааруулга:** postgres volume анхны нууц үгээ хадгалдаг. `.env`-ийг устгаад хуучин `<project>_pgdata` үлдсэн бол `start` зогсооно — хуучин `.env`-ийг сэргээх эсвэл `bj server stop --purge` / `docker volume rm <project>_pgdata`.

## Тест ажиллуулах

```bash
npm test
```

## AI-тай ажиллах: `bj mcp` (MCP сервер)

`bj mcp [хавтас]` нь [Model Context Protocol](https://modelcontextprotocol.io)-ийн stdio сервер. Таны сонгосон AI (Claude Desktop, Claude Code, Cursor,
VS Code, локал загвар …) BRD+PRD багцын **ноорог** бэлтгэхэд ашиглана. Платформ өөрөө LLM дууддаггүй.

**Хэрэгслүүд:** `list_packages`, `get_standard`, `get_schema`, `create_package`, `add_source`, `import_requirements_table`, `source_paragraphs`, `read_file`, `list_files`, `write_file`, `delete_file`, `validate`, `analyze`,
`list_questions`, `propose_answer`, `elicit_answer`, `get_plan` (сервер тохируулсан бол; lint — ROLLBACK, юу ч хадгалахгүй).

`elicit_answer` — клиент MCP elicitation дэмждэг бол (Claude Code, VS Code …) асуултыг хэрэглэгчид маягтаар шууд харуулна (сонголттой бол жагсаалт + «Бусад»).
Хариулт мөн `assumed` (`answered_by: elicit:<клиент>`) — хүн батлах хүртэл BRD-д буухгүй; дэмждэггүй клиентэд AI чатаар асууж `propose_answer`.

**AI хийж чадахгүй зүйл:** apply, deploy, purge, хариулт батлах, хариултыг BRD-д буулгах, хэрэглэгч/нууц үг/байгууллага (`seed/organisations.yaml`),
`integrations.yaml`, `questions.yaml`/`resolutions.yaml`-ийг шууд бичих, manifest-ийн `key` солих, YAML anchor/alias. Ийм хэрэгсэл байхгүй, эсвэл бичих хил татгалзана.
AI-ийн хариулт `propose_answer`-аар **санал** (`assumed`) л болно — хүн Studio-гийн «Асуултууд» эсвэл `bj questions confirm`-оор батлах хүртэл BRD-д буухгүй,
`manifest.questions: enforce` бол plan-ийг ч нээхгүй.

**Аудит:** дуудлага бүр `~/.buteemj/mcp.log` (эсвэл `BUTEEMJ_MCP_LOG`) — JSONL `{ts, trace, client, tool, args_sha256, ok, ms}`; файлын агуулга логт орохгүй. Минутад ≤ 120 дуудлага.

**Анхаар:** BRD-ийн агуулга (файлууд) таны сонгосон AI нийлүүлэгч рүү очно. Нууцлалын шаардлагатай бол байгууллагын гэрээтэй эсвэл локал загвар сонгоно.

Тохиргооны жишээ (`/path/to/project` — багцуудын хавтас):

Claude Code:
```bash
claude mcp add buteemj -- bj mcp /path/to/project
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`):
```json
{ "mcpServers": { "buteemj": { "command": "bj", "args": ["mcp", "/path/to/project"] } } }
```

VS Code (`.vscode/mcp.json`):
```json
{ "servers": { "buteemj": { "type": "stdio", "command": "bj", "args": ["mcp", "${workspaceFolder}"] } } }
```

`get_plan`-д сервер хэрэгтэй бол клиентийн тохиргооны `env`-д `BUTEEMJ_URL`, `BUTEEMJ_USER`, `BUTEEMJ_PASS` (нууц үг AI-д харагдахгүй — зөвхөн процессын орчинд).

Санал болгох ажлын урсгал (AI-д): `get_standard` → эх баримтаас `create_package`/`write_file` → `validate` (алдааг засна) → `analyze` → `list_questions` →
мэдэхгүй асуултыг хэрэглэгчээс асууна (таамаглахгүй), мэдэж байгааг `propose_answer` → хүн батална → `bj questions apply`.
