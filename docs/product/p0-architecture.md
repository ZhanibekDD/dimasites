# DNEPR СтройПаспорт / ORBIT — архитектура P0

## Цель P0

Превратить проверку компании, заключения или документа в квалифицированный строительный лид с доказуемым контекстом.

## Контуры

```text
stroydnepr.ru/proverka/  public SSR + SEO + lead flows
cabinet.stroydnepr.ru    saved objects, reports, document history
orbit.stroydnepr.ru      private lead radar and human verification queue
api.stroydnepr.ru        modular backend, integrations, OCR and CRM
```

Первый production-релиз размещается в `/proverka/` и выполняет реальный локальный анализ документов. Публичный поиск по государственным реестрам не публикуется, пока для каждого источника не подтверждены способ доступа, правовое основание и стабильный production-адаптер.

## Модульный монолит

```text
API
├── identity         users, companies, roles
├── registry         source adapters and normalized entities
├── evidence         claims, confidence, versions, audit log
├── search           query classifier and entity resolution
├── documents        upload, AV, OCR, structure, comments
├── leads            context, score, assignment, SLA
├── crm              outbound adapters and delivery log
├── seo              quality gate and indexability
├── source_health    uptime, freshness, schema drift
└── admin            verification queue and overrides
```

## Основные сущности

- `company`
- `construction_role`
- `project`
- `site_or_parcel`
- `expertise_conclusion`
- `permit`
- `procurement`
- `sro_membership`
- `license`
- `document`
- `document_finding`
- `evidence`
- `source_snapshot`
- `lead`
- `lead_event`
- `saved_object`
- `feedback`

## Query classifier

Первый слой не обращается к реестрам. Он только определяет тип:

1. ИНН — 10 или 12 цифр с контрольной суммой.
2. ОГРН/ОГРНИП — 13 или 15 цифр с контрольной суммой.
3. Кадастровый номер — структурированный номер с двоеточиями.
4. Номер закупки — длинный цифровой идентификатор.
5. ЕГРЗ/разрешение — формат и ключевые признаки.
6. Адрес — адресные маркеры и география.
7. Компания или свободный запрос — fallback.

После классификации выполняются только разрешённые source adapters.

## Реализованный Document pipeline 1.0

```text
выбор локального файла
→ проверка размера, расширения и сигнатуры
→ извлечение текста PDF / DOCX / XLSX
→ локальный OCR сканов и изображений
→ сегментация по страницам, блокам или листам
→ поиск фрагментов с признаками замечаний
→ дословная цитата и evidence anchor
→ Evidence Confidence B / C / D
→ локальный отчёт HTML / CSV / JSON
→ контакт и сводка без передачи документа
```

Файл не покидает браузер пользователя. Уровень A автоматически не присваивается: он возможен только после проверки специалистом.

## Lead Score v0

```text
+20 подтверждённая компания
+15 найден проект/заключение/разрешение
+25 загружен документ
+15 есть отказ или замечания
+10 целевой регион
+10 срок до 90 дней
+05 указан телефон и компания
```

Score не заменяет ручную оценку. Порог передачи менеджеру в пилоте — 40.

## SEO Quality Gate

Страница индексируется только если:

- есть минимум два факта уровня A;
- присутствует уникальное полезное содержание;
- показаны источники и даты;
- карточка прошла модерацию;
- нет персональных или закрытых сведений;
- источник свежий или явно указана дата актуальности.

Иначе страница получает `noindex, nofollow`.

## Инфраструктура production

- сервер и первичное хранение персональных данных в РФ;
- PostgreSQL;
- S3-совместимое закрытое хранилище с lifecycle;
- Redis/очередь фоновых задач;
- антивирусный worker;
- OCR/LLM worker без публичного доступа;
- reverse proxy и TLS;
- secrets manager;
- централизованные логи без содержимого документов;
- backup и проверяемое восстановление;
- source-health мониторинг и schema-drift alerts.
