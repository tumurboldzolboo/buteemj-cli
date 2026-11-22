# BRD+PRD-ийн загварын шинжилгээ (PLAN15)

`scripts/validate/` нь багц **зөв бичигдсэн** эсэхийг шалгадаг (схем, нэр, лавлагаа). Харин энэ модуль багц **утга зүйн хувьд бүрэн,
зөрчилгүй** эсэхийг шалгана: хүрэх боломжгүй төлөв, эрхгүй шилжилт, DMN-ийн давхцал, хамралтын цоорхой г.м.
Сервергүй, детерминист, LLM ашиглахгүй.

- validate-аас **тусдаа**: validate-ийн олдвор, JS ↔ серверийн parity, `brd-lint`/`bj validate`-ийн гаралтын код, `docs/FREEZE.md`-ийн hash өөрчлөгдөхгүй.
- Олдвор анхдагчаар зөвлөмж төдий. `--fail-on`-оор хаалт болгоно.
- Validator-ийн задлагчийг (`../validate/*.mjs`) импортолж ашиглана, өөрчлөхгүй.

```bash
node scripts/analyze/cli.mjs docs/reference/booking
```

```bash
node scripts/analyze/cli.mjs ../corpus/packages/klinik --json --min=important
```

```bash
node scripts/analyze/test.mjs
```

Гаралтын код: `0` — ажилласан (олдвортой байсан ч), `1` — `--fail-on` түвшний олдвор гарсан, `2` — ажиллаж чадсангүй.

## Хэрэглээ (A6)

| Хаана | Тушаал | Тайлбар |
|---|---|---|
| Платформ | `node scripts/bj.mjs analyze [хавтас …] [--min=…] [--fail-on=…] [--json]` | `requires`-ийн багцыг төслөөс шийднэ |
| `@buteemj/cli` | `bj analyze [хавтас] [--min=…] [--fail-on=…] [--json]` | хуулбар `cli/src/analyzer` |
| VS Code Studio | «Прожект шалгах» → Problems (`bj analyze · A<n>`) | хуулбар `studio/src/analyzer`; зөвлөмж — алдаа гэж тоологдохгүй |
| Web Studio | — | хийгээгүй (PLAN15 A6b): «Шалгах» нь C++ серверийн lint-ийг дууддаг, analyzer-т хөтчийн build хэрэгтэй (`node:crypto`, validator-ын `node:fs`) |

**Хуулбар:** CLI/Studio-гийн `npm run sync-validator` нь validator-ын дараа [sync.mjs](sync.mjs)-ийг дуудна: энэ хавтсыг (test/cli/sync-ээс бусад) хуулж
`../validate/` → `../validator/` болгоно, X0 үнэлэгчийг `web/src/lib/{expr,geo,regexp}.ts`-ээс төрөл хасаж (`node:module` `stripTypeScriptTypes`, Node ≥ 22.13) `vendor/*.mjs` болгоно —
гаралт Node ≥ 20-д ажиллана. Studio-гийн bundle-д динамик импорт ажиллахгүй тул `setX0Evaluate`-ээр статикаар холбоно. Хуучирсан хуулбарыг
`cli/test/analyzer.test.js`, `studio/test/platform-analyze.test.ts` барина.

## Олдворын гэрээ

Схем: [finding.schema.json](finding.schema.json).

| Талбар | Утга |
|---|---|
| `id` | `F-` + `sha256(code, element, discriminator)`-ийн эхний 12 тэмдэгт. **Мөрийн дугаараас үл хамаарна** — файлыг засахад тогтвортой үлдэнэ. Асуулт (PLAN15 C1) үүнийг түлхүүр болгоно |
| `code` | [codes.mjs](codes.mjs)-д бүртгэлтэй тогтвортой код (`SM-UNREACHABLE`) |
| `severity` | `blocking` — хэрэгжүүлбэл систем буруу эсвэл ажиллахгүй; `important` — бизнесийн цоорхой, систем хэрэгжинэ; `advisory` — зөвлөмж |
| `layer` | PLAN15-ийн ажлын ID (`A1` …) |
| `element` | Элементийн лавлагаа (доор) |
| `file`, `line` | Байршил (`line` 0 = файл бүхэлдээ; багцын түвшний олдворт `file` = manifest) |
| `message` | Хүнд уншигдах тайлбар |
| `evidence[]` | `{file, line, text}` — нотолгооны мөрүүд; `text` нь эх файлын мөр (≤ 300 тэмдэгт) |
| `fix` | Засах санал (сонголттой) |
| `discriminator` | Нэг элемент дээрх ижил кодын олон олдворыг ялгана (сонголттой) |

Гаралт `{key, partial, findings, stats: {blocking, important, advisory, checks}}`. `partial: true` — validate алдаатай байсан тул задлагдаагүй элемент шинжилгээнд ороогүй.
Олдворууд severity → файл → мөр → код → элементийн дарааллаар эрэмбэлэгдэнэ. Ижил оролтод гаралт байт бүрээрээ ижил байна.

## Элементийн лавлагаа

| Төрөл | Хэлбэр | Жишээ |
|---|---|---|
| package | `package:<key>` | `package:booking` |
| table | `table:<Хүснэгт>` | `table:Захиалга` |
| column | `column:<Хүснэгт>.<Багана>` | `column:Захиалга.Дүн` |
| machine | `machine:<Машин>` | `machine:Захиалгын явц` |
| state | `state:<Машин> [<Төлөв>]` | `state:Захиалгын явц [Ноорог]` |
| transition | `transition:<Машин>/<Шилжилт>[ @<Эх төлөв>]` | `transition:Захиалгын явц/Батлах @Ноорог` |
| role | `role:<Үүрэг>` | `role:Менежер` |
| requirement | `requirement:<ID>` | `requirement:R01` |
| scenario | `scenario:<#>` | `scenario:2` |
| screen | `screen:<id>` | `screen:z-form` |
| report | `report:<Нэр>` | `report:Захиалгууд` |
| decision | `decision:<файл>#<id>` | `decision:limit.dmn#Батлах хязгаар` |
| process | `process:<файл>#<id>` | `process:booking.bpmn#Process_1` |
| file | `file:<зам>` | `file:roles.csv` |

## Кодын бүртгэл

<!-- codes:start — test.mjs энэ хүснэгтийг codes.mjs-тэй тулгана -->
| Код | Түвшин | Давхарга | Утга |
|---|---|---|---|
| `AN-INPUT-INVALID` | advisory | A0 | Validate алдаатай — шинжилгээ хэсэгчилсэн |
| `AN-CHECK-FAILED` | advisory | A0 | Шалгалт ажиллаж чадсангүй |
| `SM-UNREACHABLE` | important | A1 | Хүрэх боломжгүй төлөв |
| `SM-DEAD-END` | important | A1 | Гарах шилжилтгүй эцсийн бус төлөв |
| `SM-NO-PATH-TO-FINAL` | important | A1 | Эцсийн төлөвт хүрэх замгүй |
| `SM-FINAL-UNMARKED` | advisory | A1 | Түгжигдсэн төлөв эцсийн гэж тэмдэглээгүй |
| `SM-NO-FINAL` | advisory | A1 | Эцсийн төлөв тэмдэглээгүй |
| `SM-AMBIGUOUS` | important | A1 | Ялгагдахгүй ижил товч |
| `SM-NO-ACTOR` | advisory | A1 | Шилжилтэд хэн заагаагүй |
| `PERM-TRANSITION-NOWRITE` | important | A2 | Шилжилтийн үүрэг Өөрчлөх эрхгүй |
| `PERM-CREATE-NOCREATE` | important | A2 | Үүсгэх шилжилтийн үүрэг Үүсгэх эрхгүй |
| `PERM-TASK-NOVIEW` | important | A2 | Даалгаврын бүлэг хүснэгтийг харах эрхгүй |
| `PERM-SCREEN-NOVIEW` | important | A2 | Дэлгэцийн үүрэг хүснэгтийг харах эрхгүй |
| `PERM-TABLE-NOCREATOR` | advisory | A2 | Бичлэг үүсгэх замгүй хүснэгт |
| `DMN-OVERLAP` | blocking | A3 | UNIQUE хүснэгтэд давхцсан дүрэм |
| `DMN-GAP` | important | A3 | Шийдвэрийн хүснэгтийн цоорхой |
| `DMN-SHADOWED` | important | A3 | FIRST хүснэгтэд далдлагдсан дүрэм |
| `DMN-NEVER-MATCHES` | important | A3 | Ямар ч оролтод тохирохгүй дүрэм |
| `DMN-NOT-ANALYZED` | advisory | A3 | Шийдвэрийн хүснэгтийг шинжлээгүй |
| `X0-ENUM-LITERAL` | important | A4 | Enum-д байхгүй утгатай харьцуулалт |
| `X0-NEVER-TRUE` | important | A4 | Хэзээ ч биелэхгүй нөхцөл |
| `X0-REQUIRED-HIDDEN` | blocking | A4 | Заавал атлаа нуугдсан талбар |
| `X0-GUARD-OVERLAP` | important | A4 | Ижил товчны guard зэрэг биелнэ |
| `COV-P1-UNTESTED` | important | A5 | Заавал шаардлагад сценари алга |
| `COV-REQUIRED-NOFORM` | important | A5 | Заавал багана маягтад алга |
| `COV-UNTRACED` | advisory | A5 | Шаардлагаар лавлагдаагүй элемент |
| `SLOT-MISSING` | advisory | B1 | BRD-д хариулаагүй асуулт |
| `CNL-UNPARSED` | advisory | D3 | Загварт хэлний бус мөр |
| `CNL-NOT-MODELED` | important | D2 | Текстэд бий, загварт алга |
| `CNL-CONFLICT` | important | D2 | Текст ба загварын зөрчил |
| `REQ-VAGUE` | advisory | D4 | Хэмжигдэхгүй үг |
| `REQ-DUPLICATE` | advisory | D4 | Бараг ижил шаардлага |
| `REQ-MODAL` | advisory | D4 | Модаль зөрчлийн нэр дэвшигч |
| `IR-MISSING` | advisory | E1 | Эх баримт бий, IR алга |
| `IR-INVALID` | important | E1 | IR-ийн хэлбэрийн алдаа |
| `IR-SOURCE-UNKNOWN` | important | E2 | Эх догол мөр алга |
| `IR-QUOTE-NOTFOUND` | important | E2 | Ишлэл эх текстэд алга |
| `IR-ASSUMED` | advisory | E2 | IR-ийн таамаг |
| `IR-ELEMENT-UNKNOWN` | important | E1 | IR-ийн элемент загварт алга |
| `IR-PARA-UNCOVERED` | advisory | E3 | Хамрагдаагүй догол мөр |
<!-- codes:end -->

## A1 — төлөвийн машин (`checks/states.mjs`)

Граф: зангилаа = төлөв, ирмэг = шилжилт (гараар, `after`/`when` автомат, `хэн: процесс`). Орох цэг: анхны төлөв ба
`seed/`, `defaults/`, `reference/`-д тухайн баганын утгаар өгөгдсөн төлөв. Анхны төлөв яг нэг биш машиныг алгасна (validate `states_initial`).

- `SM-NO-FINAL` гарвал тэр машинд `SM-DEAD-END`, `SM-NO-PATH-TO-FINAL` гаргахгүй — эцсийн төлвийн тэмдэглэгээгүй бол «гацсан» гэдгийг ялгах боломжгүй.
- Гарах шилжилтгүй төлөв `locked`/«зөвхөн унших» тэмдэглэлтэй бол санаатай эцсийн гэж үзэж `SM-FINAL-UNMARKED` (зөвлөмж) болно.
- `SM-AMBIGUOUS` — нэг төлвөөс ижил нэртэй товч, guard нь хоосон эсвэл давхардсан. Бүгд өөр guard-тай бол энд гаргахгүй; харилцан үгүйсгэх эсэхийг A4 шалгана.
- Guard дахь нэрийн шалгалт A4-д (сервер plan `transition_guard` анхааруулгаар аль хэдийн мэдээлдэг).

## A2 — эрх ↔ процесс (`checks/permissions.mjs`)

Серверийн семантикаар: шилжилт = хүснэгтийн Өөрчлөх эрх (GAPS G27, `ST0036`), `хэн: процесс` эрх шаардахгүй (G29), үүсгэх = «Үүсгэх» эрх,
`-` = хориг (бусад мөрийн зөвшөөрлийг дарна), үүргийг жижиг үсгээр тааруулна.

- roles.csv-д огт байхгүй үүрэг/бүлэг (seed-ийн бүлэг) шалгагдахгүй — сервер ч алгасдаг. `@<нэвтрэх нэр>` мөр үүрэгт тооцогдохгүй. Хүснэгт `*` бүх хүснэгтэд гэж үзнэ.
- Хэрэглэгч олон үүрэгтэй байж болно; олдвор нь «`хэн`-д заасан үүрэг **дангаараа** чадахгүй» гэсэн утгатай.
- `PERM-TASK-NOVIEW` — даалгаврын **харах** эрхийг л шалгана. Бичих эрхийг статикаар тогтоох боломжгүй: даалгаврын формын бичлэгийн талбар
  formData-аас биш хүснэгтийн багана × төлвийн дүрмээс үүсэх ба сервер эрхийг зөвхөн бичлэгийн утга илгээхэд шалгадаг (`BpmnTaskForm.cpp`).
- `PERM-TABLE-NOCREATOR` — seed/defaults/reference, генераторын `target`, интеграцын `inbound`, BPMN `buteemj:table`/`children`, `create(…)` action-аар
  бөглөгдөх хүснэгт, цөмийн хүснэгтийг (`Хэрэглэгч`, `Хэсэг` …) алгасна. Өөр багц эсвэл гадаад интеграцаар бөглөгдөх хүснэгтийг энэ багц дотроос ялгах боломжгүй.
- Объект мөрийн (`товч:`, `дэлгэц:`) нарийвчилсан эрх энд хамаарахгүй.

## A3 — DMN (`checks/decisions.mjs`)

Нүдний дүрэм серверийн `entryToExpression`-тэй ижил (`cgi/src/decision/Decision.cpp`): `-`/хоосон, таслал (эсвэл), `null`, `not(…)`,
`<= >= != == < > =`, муж `[a..b] (a..b) [a..b) (a..b] ]a..b[`, бусад нь тэнцүү. Таслалын хуваалт серверийн `splitTopLevel`-тэй ижил.

**Арга яг (exhaustive):** оролт бүрийн домэйныг нүднүүдийн литерал хилээр элементар хэсэгт хуваана: хил бүр, хоёр хилийн дунд, хамгийн бага/их хилээс цааш;
текстэд литерал бүр + «бусад»; boolean-д true/false. Хэсэг бүрт нүд бүр нэгэн жигд тул төлөөлөгч утгуудын бүх хослолыг шалгах нь бүх утгыг шалгахтай тэнцүү.
Оролт `record.<Багана>` бөгөөд тэр нэртэй багана ERD-д enum бол домэйн = enum-ийн утгууд («бусад» боломжгүй, дурдаагүй утга шалгагдана).

- `DMN-OVERLAP` — зөвхөн UNIQUE. Сервер үнэлэхэд алдаа буцаана → blocking.
- `DMN-GAP` — COLLECT-оос бусад. DMN файлаас default output импортлогддоггүй тул цоорхой = `null` гаралт.
- `DMN-SHADOWED` — FIRST. `DMN-NEVER-MATCHES` — бүх бодлогод.
- Литерал биш хил (`> record.Хязгаар`), холимог төрөл, 20000-аас олон хослол → `DMN-NOT-ANALYZED` (шалгагдаагүйг ил гаргана). `null` оролтыг шалгахгүй.
- Сервер ижил төстэй шалгалтыг (D3, хилийн утгаар) зөвхөн хэрэгжүүлсний дараа засварлагчийн API-д (`DecisionHandler.cpp`) хийдэг; энэ нь зохиох үед, сервергүй.

## A4 — X0 предикат (`checks/predicates.mjs`, `x0eval.mjs`)

Эх: шилжилтийн guard ба `when`, erd.dbml note-ийн `requiredWhen`, `visibleWhen`, `validation` (`> 0` → `<Багана> > 0`, `range a..b`; `regex`/`email` алгасна), DMN `record.<Багана>`.
Хувьсагч: хүснэгтийн багана, нэг алхмын FK зам (`<FK>.<Багана>`, хоосон байж болно), төлөвийн машинтай багана = төлвүүдийн enum.
Guard-ын угтвар: `мөр заавал and …` хасна; `мөр бүрт <нөхцөл>` — хүү хүснэгтийн (FK-ээр эцэг рүү заасан) контекстод (сервер `naturalGuard`-тай адил).

- `X0-ENUM-LITERAL` — түүхий текстээр, бүх предикатад (энгийн биш ч). Олон хүү хүснэгттэй `мөр бүрт`-д бүх хүүд утга алга бол л.
- Хангагдах эсэх (`X0-NEVER-TRUE`, `X0-REQUIRED-HIDDEN`, `X0-GUARD-OVERLAP`) — зөвхөн **энгийн** предикатад: нэр, литерал, `== != < <= > >=`,
  `and/or/not`, `in/not in`, `null`, хаалт. Функц, `today`/`now`, `заавал`, `calc`, 2+ алхмын зам, тооцоо (`+ - * /`) → алгасна (серверийн
  `translateExpr`-ийн нэр шийдлийг дуурайхгүй; plan-ийн `transition_guard` анхааруулга тэдгээрийг хамарна).
- Үнэлэгч: `web/src/lib/expr.ts` (сервер `Expr.cpp`-тэй нэг тестийн вектор). Платформын repo-д л — байхгүй бол хангагдах шалгалт алгасагдана (`X0-ENUM-LITERAL` ажиллана).
- Домэйн яг: enum/төлөв — утгууд; boolean — true/false; тоо — литерал хилүүд + хил хооронд ба цааш k+1 цэг (k = тоон хувьсагчийн тоо — хувьсагч хоорондын
  дараалал ч хамрагдана); текст — литерал + «бусад»; not null биш бол null. Огноо, файл төрөл → алгасна. Бүхэл тоонд бутархай цэг орох тул
  `> 5 and < 6` (бүхэл)-ийг хангагдана гэж үзнэ — дутуу илрүүлэлт (FN), ХЭ биш.
- Баганын validation-ыг `(<багана> == null or <validation>)` гэж нэмнэ (өөрийн баганаа дурдсан validation л).
- `X0-NEVER-TRUE`-ийн түвшин: guard/when/validation — important; requiredWhen/visibleWhen — advisory.
- `X0-REQUIRED-HIDDEN` — сервер `requiredWhen`-ийг харагдах эсэхээс үл хамааран шалгадаг (`RecordWriter.cpp` `checkRules`) тул blocking.

## A5 — хамралт (`checks/coverage.mjs`)

validate аль хэдийн мэдээлдгийг давхардуулахгүй: `req_untraced`, `req_link`, `scenario_req`, `req_uncovered` (бүх сценаригүй шаардлага — warning).

- `COV-P1-UNTESTED` — `req_uncovered`-ийн эрэмбэ 1 дэд олонлог (important). acceptance.md-д «Шаардлага» багана байхгүй бол хамралтыг тогтоохгүй.
- `COV-REQUIRED-NOFORM` — web маягт зөвхөн layout-ийн баганыг зурдаг (`LayoutForm.tsx`). Тухайн хүснэгтийн layout-тай аль ч маягтад байхгүй, not null,
  анхдагчгүй багана. pk, `default`/`computed`/`numbering`/`state`/`processonly`/`parent` тэмдэглэгээтэй, layout-гүй маягт (платформ бүх баганыг),
  өөр багцын `extends`-тэй хүснэгтийг алгасна. Процесс/генератороор л үүсдэг хүснэгтэд ХЭ байж болно.
- `COV-UNTRACED` (зөвлөмж) — машин, шийдвэр, BPMN процесс, тайлан, генератор ямар ч шаардлагын «Холбоос»-оор лавлагдаагүй (урвуу traceability).
  Дамжлагат: лавлагдсан дэлгэц/хуудасны дурдсан нэр, процессын `transitionTable`/`table` (→ тэр хүснэгтийн машин)/`decisionRef`/`calculationRef`,
  машины шилжилтийн action-ийн аргумент. Машин — нэрээр эсвэл шилжилтийн товчны нэрээр (төлвийн нэрээр биш). Элементийн нэрийг текстэндээ дурдсан шаардлагыг засах санал болгоно.
- «Хүснэгтэд дэлгэц алга» — хийгээгүй: дэлгэцгүй хүснэгтэд платформ маягт/жагсаалтыг автоматаар үүсгэдэг тул цоорхой биш.

## Шалгалт нэмэх

1. Кодоо [codes.mjs](codes.mjs)-д (`severity`, `layer`, `title`, `why`) болон дээрх хүснэгтэд бүртгэнэ.
2. `{id, layer, run(model, emit)}` объект бичээд [index.mjs](index.mjs)-ийн `CHECKS`-д нэмнэ. `model` — [model.mjs](model.mjs)-ийн `buildModel`.
   `emit({code, element, file, line, message, evidence?, fix?, discriminator?})`.
3. [test.mjs](test.mjs)-д эерэг (олдвор гарна) ба сөрөг (гарахгүй) fixture нэмнэ.

Бүртгэлгүй код эсвэл буруу `element` дамжуулбал тэр шалгалт `AN-CHECK-FAILED` болж зогсоно. Бусад шалгалт үргэлжилнэ.

## B — бүрэн гүйцэд байдал (`checks/slots.mjs`, `docs/brd-standard/slots.yaml`)

Мета-загвар: [docs/brd-standard/slots.yaml](../../docs/brd-standard/slots.yaml) — элементийн төрөл бүрт BRD хариулсан байх ёстой асуулт (слот).
Analyzer нь үүсгэсэн [slots.data.mjs](slots.data.mjs)-ийг уншина (`node scripts/analyze/gen-slots.mjs`; таарахыг test.mjs шалгана) — хуулбар ба bundle-д файл уншихгүй.

- Слот бүр: `id`, `element`, `title`, `question` (`{name}`), `fix`, `severity`, `detect` (илрүүлэгч), `coveredBy` (A шатны код), `options` (C1-ийн сонголтын эх).
- Бөглөгдөөгүй, `coveredBy`-гүй слот → `SLOT-MISSING` (түвшин слотоос, `discriminator` = слотын id, мессеж = асуулт). `coveredBy`-тэй слотыг A-ийн код мэдээлдэг — зөвхөн тоонд.
- `analyzePackage(...).completeness` (B2): `score` = бөглөгдсөн / хамаарах, `bySlot`, `byElement`, `missing[]`, `crud` (үүрэг × өөрийн хүснэгт: мөр бий = шийдсэн; ямар ч үүрэгт мөргүй хүснэгтүүд).
- `cli.mjs --completeness` — тайлан.
- Илрүүлэгчийн дүрэм: цөмийн хүснэгт хамаарахгүй; `table.key` — хүү (parent) хүснэгтэд биш; `table.deleter` — үүсгэх эрхтэй, машингүй, хүү биш, лавлах (reference/) биш хүснэгтэд
  (Устгах = 1 эсвэл `-` хориг = шийдсэн); `machine.reject` — татгалзах/цуцлах/буцаах нэртэй шилжилт эсвэл анхны төлвөөс хүрэх 2+ эцсийн төлөв;
  `process.trigger` — startOn/timer/message/signal/conditional, `buteemj:category` (цэс), `startProcess(…)`, дэлгэцэд нэр; `process.timeout` — userTask-тай процесст timer.

## C — асуулт ба хариулт (`questions.mjs`, `questions-cli.mjs`)

Олдвор бүр (дэд бүтцийн `AN-*` ба `DMN-NOT-ANALYZED`-аас бусад) → бизнесийн асуулт, багцын `questions.yaml`-д
(схем: [catalog/questions.schema.json](../../docs/brd-standard/catalog/questions.schema.json); `resolutions.yaml`-аас тусдаа — З3).

```bash
node scripts/bj.mjs questions sync docs/reference/procurement
```
```bash
node scripts/bj.mjs questions list docs/reference/procurement --status=all
```
```bash
node scripts/bj.mjs questions answer docs/reference/procurement Q-c8ad411d308b Нягтлан --by=<нэвтрэх нэр>
```

- `id` = `Q-` + олдворын hash (code, element, discriminator) — мөрийн дугаараас үл хамаарна → `sync` idempotent (өөрчлөлтгүй бол файлд хүрэхгүй).
- Асуулт: SLOT-MISSING бол слотын `question`; бусад кодод бизнесийн хэллэгтэй загвар (`ASK`), сонголт загвараас (бусад төлөв, үүрэг, enum-ийн утга, багана …),
  `impact` = кодын `why`, `audience` = машины `хэн` эсвэл хүснэгтэд эрхтэй үүргүүд, процесс — BPMN-ийн нэрээр.
- Төлөв: `open` → `answered` (хүн) | `assumed` (`--agent`, `answered_by: agent:<клиент>`) → `confirm --by` → `answered`; `dismiss --note` → `dismissed`.
- `sync`: хариулт/төлөв хадгалагдана; олдвор алга болвол open/answered/assumed → `resolved` (`resolved_at`, хариулт хэвээр); дахин гарвал `resolved` →
  `answered` (хариулттай) эсвэл `open`; `dismissed` хэвээр.
- Платформын YAML (`Yaml.cpp`) хашилтгүй `yes`/`null`/тоог өөр төрөл болгодог тул ийм мөрийг хашилтаар бичнэ.
- Хийгээгүй (PLAN15): C2b серверийн roundtrip (импорт/экспорт `questions.yaml`-ийг хадгалах — C++), C4 Studio UI, C5 plan-ийн хаалт.

### C3 — хариултыг BRD-д буулгах (`patch.mjs`, `bj questions apply [--dry-run] [--only=Q-…]`)

Зөвхөн `answered` (хүн); `assumed` (агент) хэзээ ч автоматаар буулгахгүй. `applied_at`-тай асуултыг дахин хэрэгжүүлэхгүй (idempotent).
`apply` нь patch-ийн дараа дахин шинжилж `sync` хийнэ: засагдсан олдвор алга → асуулт `resolved`; шинэ шилжилтийн «хэн» г.м. дараагийн асуулт үүснэ.

| Асуулт | Хариулт | Patch |
|---|---|---|
| `table.viewer` / `table.creator`, `PERM-TABLE-NOCREATOR` | үүрэг (таслалаар олон) | roles.csv Харах / Үүсгэх = 1 (мөр байхгүй бол шинэ мөр) |
| `table.deleter` | үүрэг эсвэл «Хориглоно» | Устгах = 1, эсвэл тэр хүснэгтийн бүх мөрөнд `-` |
| `table.key` | багана | erd.dbml `[unique]` (тайлбар хадгална) |
| `machine.reject` | татгалзах боломжтой төлөв(үүд) | `<Төлөв> --> Цуцлагдсан : Цуцлах`, `Цуцлагдсан --> [*]` |
| `SM-NO-ACTOR` | үүрэг | шилжилтэд `/ хэн: <Үүрэг>` |
| `SM-DEAD-END`, `SM-FINAL-UNMARKED`, `SM-NO-FINAL`, `SM-NO-PATH-TO-FINAL`, `SM-UNREACHABLE` | «Эцсийн» / төлөв | `X --> [*]` эсвэл `X --> Y : Y болгох` |
| `PERM-*` | «… эрх өгнө» | roles.csv (`subject` = үүрэг) |
| `X0-ENUM-LITERAL` | зөв утга / «шинэ утгаар нэмнэ» | литералыг засна / erd.dbml enum-д нэмнэ |
| `COV-P1-UNTESTED` | «Сценари => Хүлээгдэх» | acceptance.md-д мөр (дугаар үргэлжилнэ) |
| `COV-REQUIRED-NOFORM` | «Маягтад нэмнэ» / «Заавал биш» | screens.yaml маягтад талбар / erd.dbml `not null` хасна |
| бусад (DMN, X0-NEVER-TRUE, COV-UNTRACED, процесс …) эсвэл таарахгүй хариулт | чөлөөт | requirements.md-д шийдвэрийн мөр `\| Q-… \| Д \| <асуулт> — Хариулт: … \| 2 \| <элемент> \|` |

Хашилттай CSV мөр, танигдахгүй үүрэг/төлөв/багана — patch биш, шийдвэрийн мөр (хүн засна).
Хязгаар: «татгалзах шаардлагагүй» гэх мэт сөрөг хариулт шийдвэрийн мөр болно, гэхдээ слотын олдвор шинжилгээнд үлдэнэ (асуулт `answered` хэвээр) — шинжилгээ хариулсан асуултыг хараахан тооцохгүй.

### C2b/C5 — сервер (`questions.yaml` roundtrip, plan-ийн хаалт)

- Импорт (`Package.cpp`) `questions.yaml`-ийг задалж `model.questions`-д, эх текстийг `ST1971.ST197118`-д (migration `99zn-solution-questions.sql`) хадгална;
  дараагийн импортод файл алга бол өмнөхийг хэвээр (resolutions-тэй адил). Сангийн экспорт (`ModelExport` `questions(c)`, `?source=model`, снапшот) эх текстээр нь буцаана.
- `manifest.questions` (`enforce | warn | off`, З4 opt-in): plan нь questions.yaml-ийн `open`/`assumed` төлөвтэй blocking/important асуулт бүрт
  `enforce` — `question_open` алдаа (`{question, element}`; blocking → apply хаагдана), `warn` — `questions.yaml: …` анхааруулга. Хариулт нь questions.yaml-д (acknowledge-аар биш).
  Хаалт багцын түвшинд (элемент бүрээр биш — хаах асуулттай элементийг л хаах нь цаашдын ажил).
- Шинжилгээ (JS): questions.yaml-д `dismissed`, эсвэл `answered` + `applied_at` (буулгасан атлаа олдвор үлдсэн — шийдвэрийн мөр) асуулттай олдворыг үндсэн жагсаалтаас
  гаргаж `acknowledged[]`, `stats.acknowledged`-д тоолно. `bj questions sync/apply` нь `acknowledge: false` — бүх олдворыг хардаг (эс бөгөөс хүлээн зөвшөөрсөн асуулт resolved болно).
- e2e: `web/e2e/questions_roundtrip_smoke.mjs` (импорт → ноорог экспорт → plan off/warn/enforce → assumed хаана → answered → apply → сангийн экспорт ижил).

## D — загварт хэл ба шаардлагын текст (`cnl.mjs`, `checks/cnl.mjs`, `checks/reqtext.mjs`, `cnl-cli.mjs`)

- `cnl.mjs`: `vocabulary(model)` (загварын нэрс), `tag` (`«…»` ишлэл → урт үндэс + дагавар; богиносгосон үндэс дагавартай л), `parseSentence` (эрх, хориг, шилжилт, заавал/давтагдахгүй, эцсийн төлөв — нэрийн олон утгыг загвар бүр `pick`-ээр ялгана),
  `parseDocument` (`brd.md` → баримт + unparsed мөр), `compare` (present | missing | conflict), `renderCnl` (загвар → өгүүлбэр, roundtrip).
- `checks/cnl.mjs` — `brd.md` байвал л: `CNL-UNPARSED`, `CNL-NOT-MODELED`, `CNL-CONFLICT`. `patch.mjs` `applyFacts` — «missing»-ийг загварт (`setRight`, `addToMachine`, `editColumn`).
- `checks/reqtext.mjs` (D4, зөвлөмж): `REQ-VAGUE` (бүдэг үгийн жагсаалт; хаалт доторх тайлбарыг тоолохгүй; «бусад/олон/сайн» корпуст нарийн утгатай тул хассан),
  `REQ-DUPLICATE` (үгийн Jaccard ≥ 0.85, ≥ 5 үг), `REQ-MODAL` (яг ижил загварын нэрс + «заавал/хийнэ» ↔ «болохгүй/шаардлагагүй»).
- Үнэлгээ: `node scripts/analyze/cnl-eval.mjs --write` → `docs/analysis/cnl-eval.md` (roundtrip 4023 баримт 100% present, 0 unparsed; эсрэг илрүүлэлт 982/982).

## E — эх баримтын IR (`ir.mjs`, `checks/ir.mjs`, `docs/brd-standard/catalog/ir.schema.json`)

- Эх баримт: `sources/*.md|txt` (E4: docx/xlsx/pdf → текст — дараа). IR: `sources/ir.json` — атом шаардлага бүр `source: "<файл>#¶n"` ба үгчлэн `quote`, сонголттой `element` (analyze-ийн лавлагаа), `assumed`; `ignored` — шаардлагагүй догол мөр.
- `paragraphs`: хоосон мөрөөр блок; жагсаалтын мөр бүр, хүснэгтийн өгөгдлийн мөр бүр тусдаа; гарчиг = хэсэг; код, `<!-- -->` алгасна. Дугаарыг `bj cnl paras --file=<файл>` эсвэл MCP `source_paragraphs`-аар харна.
- `normalize` (E2): NFKC, жижиг үсэг, хашилт ба `*_` хасна, зураас нэгтгэнэ, ö/ü/θ → ө/ү, ё → е, үл үзэгдэх тэмдэгт, хоосон зай. Ишлэл өөр догол мөрт байвал зөв дугаарыг санал болгоно.
- Олдвор: IR-MISSING, IR-INVALID (JSON, схем, давхар id), IR-SOURCE-UNKNOWN, IR-QUOTE-NOTFOUND (assumed бол шалгахгүй), IR-ASSUMED, IR-ELEMENT-UNKNOWN, IR-PARA-UNCOVERED.
  Асуулт болохгүй (IR бичигчийн засвар): IR-INVALID, IR-SOURCE-UNKNOWN, IR-MISSING. IR-PARA-UNCOVERED-д «Үгүй — тайлбар» гэж хариулбал `bj questions apply` нь `ignored`-д нэмнэ.
- Хамралт (E3): `analyzePackage(...).sources` = {total, covered, ignored, ratio}; `bj analyze`-д «эх баримтын хамралт …» мөр. Хамралтад зөвхөн `sources/` тооцогдоно; `brd.md` зэрэг багцын бусад файлыг эх болгон заах боломжтой (`bj cnl ir --write` — EARS-MN баримтаас `CNL-*` элемент, гараар бичсэнийг хадгална).
- E4 `extract.mjs` (гадны сангүй, node:zlib): `readZip` (stored/deflate; zip64, шифрлэлт — татгалзана; entry ≤ 30MB, нийт ≤ 60MB, харьцаа ≤ 200 — `cgi/src/integration/Xlsx.cpp`-тэй ижил),
  `docxToMarkdown` (Heading N / Title / outlineLvl → `#`, numPr ба «List Bullet/Number» хэв маяг → `-`, хүснэгт → Markdown, `w:delText` хасна), `xlsxToMarkdown` (sheet бүр `## <нэр>` + хүснэгт; shared/inline/bool),
  `pdfToMarkdown` (pdfjs-dist 6.5.438, динамик ачаалалт — `platform/scripts`-д `npm install`; мөр/догол/гарчиг/жагсаалтыг байрлал ба үсгийн өндрөөр; OCR-гүй), `extractSourceAsync`. `sources-cli.mjs` + `bj sources <add|list>`; MCP `add_source` (зөвхөн ажлын хавтас доторх файл, дарахгүй).
- D5 `reqtable.mjs`: `mapColumns` (синонимын дарааллаар exact → contains; `map`-аар дарна), `normKind` (Ө/П/Д/Дэ/Э/Т — үг/англи/contains, эс бөгөөс текстээс таамаг, анхдагч Д), `normPriority` (MoSCoW, өндөр/дунд/бага, P1–P4; хоосон → 2 таамаг),
  `convertTable` — шинэ мөр (тоон/давхар ID → `R<n>` одоо байгаа өргөнөөр), давхардсан текстийг алгасаж IR-ийг одоо байгаа шаардлагад холбоно, хоосон Холбоосыг текстээс (хүснэгт/төлөв/үүрэг) санал болгоно, текстгүй мөр → `ignored`; idempotent.
  `bj sources table`, MCP `import_requirements_table` (анхдагч — санал). Корпусын roundtrip 1094/1094.

