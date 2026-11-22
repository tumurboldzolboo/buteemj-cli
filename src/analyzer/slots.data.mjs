// ҮҮСГЭСЭН ФАЙЛ — гараар засахгүй. Эх: docs/brd-standard/slots.yaml; шинэчлэх: node scripts/analyze/gen-slots.mjs
export default {
  "version": 1,
  "slots": [
    {
      "id": "table.creator",
      "element": "table",
      "title": "Хэн үүсгэх",
      "question": "«{name}»-ийн бичлэгийг хэн (аль үүрэг) үүсгэх вэ, эсвэл систем өөрөө (seed, генератор, процесс, интеграц) үүсгэх үү?",
      "fix": "roles.csv-д тэр хүснэгтэд Үүсгэх эрхтэй мөр, эсвэл seed/генератор/процесс",
      "severity": "advisory",
      "detect": "tableCreator",
      "coveredBy": "PERM-TABLE-NOCREATOR",
      "options": "roles"
    },
    {
      "id": "table.viewer",
      "element": "table",
      "title": "Хэн харах",
      "question": "«{name}»-ийг хэн (аль үүрэг) харах вэ?",
      "fix": "roles.csv-д тэр хүснэгтийн Харах = 1 мөр",
      "severity": "important",
      "detect": "tableViewer",
      "options": "roles"
    },
    {
      "id": "table.key",
      "element": "table",
      "title": "Давтагдашгүй түлхүүр",
      "question": "«{name}»-ийн нэг бичлэгийг юугаар ялгах вэ (давтагдах ёсгүй талбар: дугаар, код, регистр …)?",
      "fix": "erd.dbml-д багананы [unique] / note 'unique' / 'numbering', эсвэл indexes { (…) [unique] }",
      "severity": "advisory",
      "detect": "tableKey",
      "options": "columns"
    },
    {
      "id": "table.deleter",
      "element": "table",
      "title": "Устгах бодлого",
      "question": "«{name}»-д алдаатай бүртгэсэн бичлэгийг хэн устгах вэ, эсвэл устгахыг хориглох уу?",
      "fix": "roles.csv-д Устгах = 1 (хэн устгах) эсвэл `-` (хориг) — эсвэл төлөвийн машинаар (цуцлах) хаана",
      "severity": "advisory",
      "detect": "tableDeleter",
      "options": "roles"
    },
    {
      "id": "machine.final",
      "element": "machine",
      "title": "Эцсийн төлөв",
      "question": "«{name}»-ийн бичлэг аль төлөвт хаагдах (дуусах) вэ?",
      "fix": "states.mmd-д `<Төлөв> --> [*]`",
      "severity": "advisory",
      "detect": "machineFinal",
      "coveredBy": "SM-NO-FINAL",
      "options": "states"
    },
    {
      "id": "machine.reject",
      "element": "machine",
      "title": "Татгалзах / цуцлах зам",
      "question": "«{name}»-ийн бичлэгийг татгалзах, цуцлах эсвэл буцаах боломжтой юу? Тийм бол аль төлвөөс, хэн, аль төлөвт шилжүүлэх вэ?",
      "fix": "states.mmd-д цуцлах/татгалзах/буцаах шилжилт, эсвэл хоёр дахь эцсийн төлөв",
      "severity": "advisory",
      "detect": "machineReject",
      "options": "states"
    },
    {
      "id": "machine.actor",
      "element": "machine",
      "title": "Шилжилт бүрийн хэн",
      "question": "«{name}»-ийн шилжилт бүрийг хэн (аль үүрэг) хийх вэ?",
      "fix": "states.mmd-д шилжилт бүрт `/ хэн: <Үүрэг>`",
      "severity": "advisory",
      "detect": "machineActor",
      "coveredBy": "SM-NO-ACTOR",
      "options": "roles"
    },
    {
      "id": "process.end",
      "element": "process",
      "title": "Төгсгөл",
      "question": "«{name}» процесс хаана, ямар үр дүнгээр дуусах вэ?",
      "fix": "*.bpmn-д endEvent",
      "severity": "important",
      "detect": "processEnd"
    },
    {
      "id": "process.trigger",
      "element": "process",
      "title": "Эхлүүлэгч",
      "question": "«{name}» процесс юугаар эхлэх вэ (бичлэг үүсэх/засагдах, хуваарь, гадаад мессеж, хэрэглэгч цэснээс)?",
      "fix": "startEvent-д buteemj:startOn / timer / message, шилжилтэд startProcess(…), эсвэл process-д buteemj:category (цэс)",
      "severity": "advisory",
      "detect": "processTrigger"
    },
    {
      "id": "process.timeout",
      "element": "process",
      "title": "Хугацаа хэтрэх",
      "question": "«{name}»-ийн хүний алхам хугацаандаа гүйцэтгэгдээгүй бол юу болох вэ (сануулах, дээд шат руу, автоматаар шийдэх)?",
      "fix": "userTask-д timer boundaryEvent (`P2D` г.м.) ба түүний зам",
      "severity": "advisory",
      "detect": "processTimeout"
    },
    {
      "id": "requirement.trace",
      "element": "requirement",
      "title": "Хэрэгжүүлэх элемент",
      "question": "{name} шаардлагыг багцын аль элемент (хүснэгт, төлөв, дэлгэц, тайлан …) хэрэгжүүлэх вэ?",
      "fix": "requirements.md-ийн «Холбоос» баганад элементийн нэр",
      "severity": "important",
      "detect": "requirementTrace",
      "coveredBy": "req_untraced"
    },
    {
      "id": "requirement.acceptance",
      "element": "requirement",
      "title": "Хүлээн авах шалгуур",
      "question": "{name} (заавал) шаардлага хэрэгжсэнийг ямар сценариар шалгах вэ?",
      "fix": "acceptance.md-д сценари, «Шаардлага» баганад ID",
      "severity": "important",
      "detect": "requirementAcceptance",
      "coveredBy": "COV-P1-UNTESTED"
    },
    {
      "id": "package.roles",
      "element": "package",
      "title": "Эрхийн матриц",
      "question": "Системд ямар үүрэг (хэрэглэгчийн бүлэг) байх ба тус бүр юуг харах, үүсгэх, засах, устгах вэ?",
      "fix": "roles.csv",
      "severity": "important",
      "detect": "packageRoles"
    },
    {
      "id": "package.acceptance",
      "element": "package",
      "title": "Хүлээн авах сценари",
      "question": "Системийг хүлээн авахдаа ямар сценариудаар шалгах вэ, тус бүр аль шаардлагыг шалгах вэ?",
      "fix": "acceptance.md («#, Сценари, Хүлээгдэх, Шаардлага» хүснэгт)",
      "severity": "advisory",
      "detect": "packageAcceptance"
    }
  ]
};
