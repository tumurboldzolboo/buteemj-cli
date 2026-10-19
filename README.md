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
