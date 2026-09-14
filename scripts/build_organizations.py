#!/usr/bin/env python3
"""Build a curated, static organization directory from the regional XLSX export."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import html
import json
import math
import re
import shutil
import sys
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import pandas as pd
except ImportError as exc:  # pragma: no cover - local authoring dependency
    raise SystemExit("pandas is required to read the source XLSX files") from exc

from organizations_taxonomy import GROUPS, classify, split_values


DOMAIN = "https://stroydnepr.ru"
REGION = "Воронежская область"
REGION_SLUG = "voronezhskaya-oblast"
PAGE_SIZE = 80
ASSET_VERSION = "20260914-org1"
SOCIAL_OR_DIRECTORY_HOSTS = {
    "2gis.ru", "facebook.com", "google.com", "instagram.com", "linktr.ee", "ok.ru",
    "t.me", "taplink.cc", "telegram.me", "vk.com", "wa.me", "whatsapp.com", "x.com",
    "yandex.ru", "youtu.be", "youtube.com",
}
TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def clean(value: object, limit: int = 600) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).replace("\xa0", " ").replace("\u2028", " ").replace("\u2029", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def slugify(value: str, limit: int = 72) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().translate(TRANSLIT)
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return (value[:limit].rstrip("-") or "organization")


def split_websites(value: object) -> list[str]:
    websites = []
    for candidate in re.split(r"[,;\n]+", clean(value, 1600)):
        candidate = candidate.strip().rstrip(".")
        if not candidate:
            continue
        if not re.match(r"^https?://", candidate, re.IGNORECASE):
            candidate = "https://" + candidate
        try:
            parsed = urllib.parse.urlsplit(candidate)
        except ValueError:
            continue
        host = (parsed.hostname or "").casefold().removeprefix("www.")
        if parsed.scheme not in {"http", "https"} or not host or "." not in host:
            continue
        if any(host == blocked or host.endswith("." + blocked) for blocked in SOCIAL_OR_DIRECTORY_HOSTS):
            continue
        websites.append(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, "")))
    return list(dict.fromkeys(websites))


def parse_phones(*values: object) -> list[dict[str, str]]:
    phones = []
    seen = set()
    for value in values:
        for candidate in re.split(r"[,;\n]+", clean(value, 1200)):
            label = re.sub(r"[‒–—]", "-", candidate).strip()
            digits = re.sub(r"\D", "", label)
            if len(digits) == 10:
                digits = "7" + digits
            elif len(digits) == 11 and digits.startswith("8"):
                digits = "7" + digits[1:]
            if len(digits) != 11 or not digits.startswith("7") or digits in seen:
                continue
            seen.add(digits)
            phones.append({"label": label, "href": "+" + digits})
    return phones[:3]


def parse_coordinate(value: object, low: float, high: float) -> float | None:
    try:
        number = float(clean(value).replace(",", "."))
    except ValueError:
        return None
    return number if low <= number <= high else None


def stable_suffix(record_id: str, key: str) -> str:
    digits = re.sub(r"\D", "", record_id)
    return digits[-9:] if digits else hashlib.sha1(key.encode("utf-8")).hexdigest()[:9]


def load_records(source: Path) -> tuple[list[dict], collections.Counter, int, int]:
    source_files = sorted(source.rglob("*.xlsx"))
    if not source_files:
        raise SystemExit(f"No XLSX files found in {source}")

    raw_rows = 0
    rejected = collections.Counter()
    candidates = []
    for path in source_files:
        frame = pd.read_excel(path, sheet_name=0, dtype=object).dropna(how="all")
        raw_rows += len(frame)
        for row in frame.to_dict("records"):
            name = clean(row.get("Название"), 180)
            district = clean(row.get("Район"), 120)
            city = clean(row.get("Город"), 120)
            address = clean(row.get("Адрес"), 220)
            rubrics = split_values(row.get("Рубрика"))
            subrubrics = split_values(row.get("Подрубрика"))
            groups, matched = classify(name, rubrics, subrubrics)
            if not groups:
                rejected["not_relevant_or_generic"] += 1
                continue
            if not name or not district or not city or not address:
                rejected["missing_identity_or_location"] += 1
                continue

            phones = parse_phones(row.get("Телефон"), row.get("Мобильный телефон"))
            websites = split_websites(row.get("Сайт"))
            if not phones or not websites:
                rejected["missing_full_phone_or_independent_website"] += 1
                continue

            key = "|".join([name.casefold(), district.casefold(), city.casefold(), address.casefold()])
            candidates.append({
                "source_id": clean(row.get("ID"), 40),
                "key": key,
                "name": name,
                "region": clean(row.get("Регион"), 100) or REGION,
                "district": district,
                "city": city,
                "address": address,
                "postal_code": re.sub(r"\D", "", clean(row.get("Индекс"), 20))[:6],
                "phones": phones,
                "website": websites[0],
                "groups": groups,
                "categories": matched,
                "hours": clean(row.get("Время работы"), 500),
                "latitude": parse_coordinate(row.get("Широта"), 40, 70),
                "longitude": parse_coordinate(row.get("Долгота"), 20, 70),
            })

    unique = {}
    duplicates = 0
    for item in candidates:
        if item["key"] in unique:
            duplicates += 1
            continue
        unique[item["key"]] = item

    records = sorted(unique.values(), key=lambda item: (item["district"].casefold(), item["name"].casefold(), item["address"].casefold()))
    used_urls = set()
    for item in records:
        district_slug = slugify(item["district"])
        base = slugify(item["name"], 64)
        suffix = stable_suffix(item["source_id"], item["key"])
        slug = f"{base}-{suffix}"
        url = f"/organizations/{REGION_SLUG}/{district_slug}/{slug}/"
        if url in used_urls:
            url = f"/organizations/{REGION_SLUG}/{district_slug}/{slug}-{hashlib.sha1(item['key'].encode()).hexdigest()[:5]}/"
        used_urls.add(url)
        item["district_slug"] = district_slug
        item["url"] = url
        item.pop("key", None)
    return records, rejected, raw_rows, duplicates


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def short(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def schema(data: object) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=False).replace("</", "<\\/")


def page_head(title: str, description: str, canonical: str, structured_data: object, extra: str = "") -> str:
    title = short(title, 78)
    description = short(description, 190)
    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title><meta name="description" content="{esc(description)}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="{esc(canonical)}">{extra}<meta property="og:type" content="website"><meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="Группа компаний ДНЕПР"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(description)}"><meta property="og:url" content="{esc(canonical)}">
<link rel="icon" href="/assets/images/logo-v2.svg?v=20260811-snow2" type="image/svg+xml"><link rel="stylesheet" href="/assets/css/main.css?v=20260813-seo1"><link rel="stylesheet" href="/assets/css/organizations.css?v={ASSET_VERSION}">
<script type="application/ld+json">{schema(structured_data)}</script></head>"""


def header() -> str:
    return """<body><a class="skip-link" href="#main">К содержанию</a><header class="site-header inner-header"><div class="container header-inner"><a class="brand" href="/" aria-label="ГК ДНЕПР — на главную"><img class="brand-mark" src="/assets/images/logo-v2.svg?v=20260811-snow2" alt="" width="46" height="46"><span class="brand-copy"><strong>ДНЕПР</strong><span>Группа компаний · Муравленко</span></span></a><button class="menu-button" type="button" aria-expanded="false" aria-label="Открыть меню">☰</button><nav class="main-nav" aria-label="Основная навигация"><a href="/about/">Компания</a><a href="/services/">Услуги</a><a href="/projects/">Объекты</a><a href="/proverka/poisk/">Стройпоиск</a><a href="/organizations/" aria-current="page">Организации</a><a href="/contacts/">Контакты</a><a class="header-cta" href="/contacts/#request">Направить ТЗ</a></nav></div></header>"""


def footer(include_search: bool = False) -> str:
    search_script = f'<script src="/assets/js/organizations.js?v={ASSET_VERSION}" defer></script>' if include_search else ""
    return f"""<footer class="site-footer"><div class="container"><div class="footer-main"><div class="footer-about"><a class="brand" href="/"><img class="brand-mark" src="/assets/images/logo-v2.svg?v=20260811-snow2" alt="" width="46" height="46"><span class="brand-copy"><strong>ДНЕПР</strong><span>Группа компаний</span></span></a><p>Строительство, монтаж и проектирование промышленных и гражданских объектов.</p></div><div class="footer-column"><h3>Разделы</h3><nav><a href="/about/">Компания</a><a href="/services/">Услуги</a><a href="/projects/">Объекты</a><a href="/organizations/">Организации</a></nav></div><div class="footer-column"><h3>Инструменты</h3><nav><a href="/proverka/">Проверка документа</a><a href="/proverka/poisk/">Стройпоиск</a><a href="/knowledge/">База знаний</a></nav></div><div class="footer-column"><h3>Контакты</h3><address><a href="tel:+73496453002">+7 (3496) 45-30-02</a><a href="mailto:office@stroydnepr.ru">office@stroydnepr.ru</a><span>г. Муравленко, ул. Нефтяников, 84</span></address></div></div><div class="footer-bottom"><span>© 2026 ООО «ДНЕПР»</span><a href="/privacy/">Политика конфиденциальности</a></div></div></footer>{search_script}<script src="/assets/js/main.js?v=20260813-seo1" defer></script></body></html>"""


def breadcrumbs(items: list[tuple[str, str | None]]) -> str:
    output = []
    for label, href in items:
        output.append(f'<a href="{esc(href)}">{esc(label)}</a>' if href else f"<span>{esc(label)}</span>")
    return '<nav class="org-breadcrumbs" aria-label="Хлебные крошки">' + "<i>→</i>".join(output) + "</nav>"


def breadcrumb_schema(items: list[tuple[str, str]]) -> dict:
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": position, "name": label, "item": DOMAIN + href}
            for position, (label, href) in enumerate(items, 1)
        ],
    }


def write_url(site: Path, url: str, content: str) -> Path:
    destination = site / url.strip("/") / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8", newline="\n")
    return destination


def map_link(item: dict) -> str:
    if item["latitude"] is None or item["longitude"] is None:
        query = urllib.parse.quote_plus(f"{item['city']}, {item['address']}")
        return f"https://www.openstreetmap.org/search?query={query}"
    lat, lon = item["latitude"], item["longitude"]
    return f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=16/{lat:.6f}/{lon:.6f}"


def company_page(item: dict, generated_label: str) -> str:
    canonical = DOMAIN + item["url"]
    primary = GROUPS[item["groups"][0]]
    description = f"{item['name']}: {primary['short']}. {item['city']}, {item['address']}. Телефон, сайт и профиль организации в строительном справочнике."
    phone = item["phones"][0]
    website_host = urllib.parse.urlsplit(item["website"]).hostname or item["website"]
    categories = "".join(f"<li>{esc(category)}</li>" for category in item["categories"])
    group_tags = "".join(f"<span>{esc(GROUPS[group]['label'])}</span>" for group in item["groups"])
    fits = "".join(f"<p>{esc(GROUPS[group]['fit'])}</p>" for group in item["groups"])
    hours = f'<div><dt>Режим работы</dt><dd>{esc(item["hours"])}</dd></div>' if item["hours"] else ""
    postal = f'<meta itemprop="postalCode" content="{esc(item["postal_code"])}">' if item["postal_code"] else ""
    district_url = f"/organizations/{REGION_SLUG}/{item['district_slug']}/"
    schema_items = [
        {
            "@type": "WebPage", "@id": canonical, "url": canonical, "name": item["name"],
            "description": description, "inLanguage": "ru-RU", "dateModified": generated_label,
            "isPartOf": {"@id": DOMAIN + "/#website"}, "publisher": {"@id": DOMAIN + "/#organization"},
            "about": {"@id": canonical + "#listed-organization"},
        },
        {
            "@type": "Organization", "@id": canonical + "#listed-organization", "name": item["name"],
            "url": item["website"], "telephone": phone["href"],
            "address": {
                "@type": "PostalAddress", "streetAddress": item["address"], "addressLocality": item["city"],
                "addressRegion": REGION, "postalCode": item["postal_code"] or None, "addressCountry": "RU",
            },
        },
        breadcrumb_schema([
            ("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"),
            (item["district"], district_url), (item["name"], item["url"]),
        ]),
    ]
    content = f"""{page_head(f"{item['name']} — {item['city']}: контакты и профиль", description, canonical, {"@context": "https://schema.org", "@graph": schema_items})}{header()}
<main id="main"><section class="org-profile-hero"><div class="container">{breadcrumbs([("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"), (item["district"], district_url), (item["name"], None)])}<p class="eyebrow light">Строительный справочник · {esc(item['district'])}</p><h1>{esc(item['name'])}</h1><p class="org-profile-lead">{esc(primary['label'])} · {esc(item['city'])}</p><div class="org-profile-tags">{group_tags}</div><div class="org-independent-note"><strong>Независимая справочная карточка.</strong> ГК «ДНЕПР» не является представителем, филиалом или владельцем этой организации.</div></div></section>
<section class="section org-profile-section"><div class="container org-profile-layout"><article class="org-profile-main"><p class="eyebrow">Сведения об организации</p><h2>Контакты и профиль</h2><dl class="org-facts"><div><dt>Организация</dt><dd>{esc(item['name'])}</dd></div><div><dt>Адрес</dt><dd itemprop="address">{esc(item['city'])}, {esc(item['address'])}{postal}</dd></div><div><dt>Район</dt><dd><a href="{esc(district_url)}">{esc(item['district'])}</a></dd></div>{hours}</dl><h2>Профиль деятельности</h2><ul class="org-category-list">{categories}</ul><div class="org-fit-copy">{fits}</div><h2>Что проверить перед обращением</h2><p>Контакты, режим работы и перечень услуг могут меняться. Уточните актуальные сведения по телефону или на указанном сайте организации. Карточка сформирована по справочным данным, переданным владельцу сайта, и обновлена {esc(generated_label)}.</p></article>
<aside class="org-contact-card"><span>Контакты из справочной записи</span><a class="org-phone" href="tel:{esc(phone['href'])}">{esc(phone['label'])}</a><a class="button button-primary" href="{esc(item['website'])}" target="_blank" rel="noopener noreferrer">Сайт организации <span class="arrow">↗</span></a><small>{esc(website_host)}</small><a class="org-map-link" href="{esc(map_link(item))}" target="_blank" rel="noopener noreferrer">Показать адрес на карте</a><p>Перед визитом подтвердите адрес и время работы.</p></aside></div></section>
<section class="org-dnepr-cta"><div class="container"><div><p class="eyebrow light">ГК «ДНЕПР»</p><h2>Нужен подрядчик на проектирование или строительство?</h2><p>Оценим исходные данные, объём работ и следующий шаг по промышленному или гражданскому объекту.</p></div><div><a class="button button-primary" href="/contacts/#request">Обсудить объект <span class="arrow">↗</span></a><a href="tel:+73496453002" class="org-dnepr-phone">+7 (3496) 45-30-02</a></div></div></section></main>{footer()}"""
    return content


def company_card(item: dict) -> str:
    profile = ", ".join(item["categories"][:3])
    return f"""<article class="org-list-card"><p>{esc(item['city'])}</p><h2><a href="{esc(item['url'])}">{esc(item['name'])}</a></h2><address>{esc(item['address'])}</address><span>{esc(profile)}</span><a class="org-list-more" href="{esc(item['url'])}">Открыть карточку →</a></article>"""


def listing_page(district: str, district_slug: str, group: str, items: list[dict], page: int, pages: int) -> tuple[str, str]:
    group_data = GROUPS[group]
    base_url = f"/organizations/{REGION_SLUG}/{district_slug}/{group}/"
    url = base_url if page == 1 else f"{base_url}page-{page}/"
    canonical = DOMAIN + url
    district_url = f"/organizations/{REGION_SLUG}/{district_slug}/"
    title_suffix = f" — страница {page}" if page > 1 else ""
    description = f"{group_data['label']} в {district}: список профильных организаций с адресами, телефонами и сайтами{title_suffix.lower()}."
    start = (page - 1) * PAGE_SIZE
    cards = "".join(company_card(item) for item in items[start : start + PAGE_SIZE])
    nav = []
    if page > 1:
        prev = base_url if page == 2 else f"{base_url}page-{page - 1}/"
        nav.append(f'<a href="{prev}" rel="prev">← Предыдущая</a>')
    nav.append(f"<span>Страница {page} из {pages}</span>")
    if page < pages:
        nav.append(f'<a href="{base_url}page-{page + 1}/" rel="next">Следующая →</a>')
    extra = ""
    if page > 1:
        prev = DOMAIN + (base_url if page == 2 else f"{base_url}page-{page - 1}/")
        extra += f'<link rel="prev" href="{esc(prev)}">'
    if page < pages:
        extra += f'<link rel="next" href="{esc(DOMAIN + base_url + f"page-{page + 1}/")}">'
    structured = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": canonical, "url": canonical, "name": f"{group_data['label']} — {district}", "description": description, "inLanguage": "ru-RU", "isPartOf": {"@id": DOMAIN + "/#website"}},
        breadcrumb_schema([("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"), (district, district_url), (group_data["label"], url)]),
    ]}
    content = f"""{page_head(f"{group_data['label']} в {district}{title_suffix}", description, canonical, structured, extra)}{header()}<main id="main"><section class="org-list-hero"><div class="container">{breadcrumbs([("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"), (district, district_url), (group_data['label'], None)])}<p class="eyebrow light">{esc(district)} · {len(items)} организаций</p><h1>{esc(group_data['label'])}</h1><p>{esc(description)}</p></div></section><section class="section"><div class="container"><div class="org-list-grid">{cards}</div><nav class="org-pagination" aria-label="Страницы списка">{''.join(nav)}</nav><div class="org-directory-note"><strong>Как сформирован список</strong><p>Показаны организации с профильной строительной категорией, полным адресом, телефоном и отдельным сайтом. Непрофильные записи в каталог не включены.</p></div></div></section></main>{footer()}"""
    return url, content


def district_page(district: str, items: list[dict]) -> tuple[str, str]:
    district_slug = items[0]["district_slug"]
    url = f"/organizations/{REGION_SLUG}/{district_slug}/"
    canonical = DOMAIN + url
    group_counts = collections.Counter(group for item in items for group in item["groups"])
    group_cards = []
    for group, data in GROUPS.items():
        count = group_counts[group]
        if not count:
            continue
        group_cards.append(f'<a class="org-group-card" href="{url}{group}/"><span>{count}</span><h2>{esc(data["label"])}</h2><p>{esc(data["short"])}</p><b>Смотреть список →</b></a>')
    sample_cards = "".join(company_card(item) for item in items[:12])
    description = f"Профильные строительные организации в {district}, Воронежская область: {len(items)} проверенных по структуре записей с адресами, телефонами и сайтами."
    structured = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": canonical, "url": canonical, "name": f"Строительные организации — {district}", "description": description, "inLanguage": "ru-RU", "isPartOf": {"@id": DOMAIN + "/#website"}},
        breadcrumb_schema([("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"), (district, url)]),
    ]}
    content = f"""{page_head(f"Строительные организации — {district}", description, canonical, structured)}{header()}<main id="main"><section class="org-list-hero"><div class="container">{breadcrumbs([("Главная", "/"), ("Организации", "/organizations/"), (REGION, f"/organizations/{REGION_SLUG}/"), (district, None)])}<p class="eyebrow light">Воронежская область · {len(items)} организаций</p><h1>{esc(district)}</h1><p>{esc(description)}</p></div></section><section class="section"><div class="container"><div class="org-group-grid">{''.join(group_cards)}</div><div class="section-head org-section-head"><div><p class="eyebrow">Организации района</p><h2 class="section-title">Первые карточки по алфавиту</h2></div><p class="section-lead">Полные списки распределены по профильным разделам, чтобы каталог оставался удобным.</p></div><div class="org-list-grid">{sample_cards}</div></div></section></main>{footer()}"""
    return url, content


def region_page(records: list[dict]) -> tuple[str, str]:
    url = f"/organizations/{REGION_SLUG}/"
    canonical = DOMAIN + url
    districts = collections.defaultdict(list)
    for item in records:
        districts[item["district"]].append(item)
    district_cards = []
    for district, items in sorted(districts.items(), key=lambda pair: pair[0].casefold()):
        district_cards.append(f'<a class="org-district-card" href="{url}{items[0]["district_slug"]}/"><span>{len(items)}</span><h2>{esc(district)}</h2><b>Открыть район →</b></a>')
    group_counts = collections.Counter(group for item in records for group in item["groups"])
    group_stats = "".join(f'<div><strong>{group_counts[group]}</strong><span>{esc(data["label"])}</span></div>' for group, data in GROUPS.items())
    description = f"Строительный справочник Воронежской области: {len(records)} профильных организаций в {len(districts)} районах. Поиск по названию, адресу и направлению деятельности."
    structured = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": canonical, "url": canonical, "name": f"Строительные организации — {REGION}", "description": description, "inLanguage": "ru-RU", "isPartOf": {"@id": DOMAIN + "/#website"}},
        breadcrumb_schema([("Главная", "/"), ("Организации", "/organizations/"), (REGION, url)]),
    ]}
    content = f"""{page_head(f"Строительные организации Воронежской области", description, canonical, structured)}{header()}<main id="main"><section class="org-region-hero"><div class="container">{breadcrumbs([("Главная", "/"), ("Организации", "/organizations/"), (REGION, None)])}<p class="eyebrow light">Строительный справочник</p><h1>Воронежская область</h1><p>{esc(description)}</p><div class="org-stat-grid">{group_stats}</div></div></section><section class="section"><div class="container"><div class="section-head org-section-head"><div><p class="eyebrow">География</p><h2 class="section-title">Районы и городские округа</h2></div><p class="section-lead">В каталог включены только записи с профильной деятельностью и полноценными контактами.</p></div><div class="org-district-grid">{''.join(district_cards)}</div></div></section></main>{footer()}"""
    return url, content


def root_page(records: list[dict]) -> tuple[str, str]:
    url = "/organizations/"
    canonical = DOMAIN + url
    districts = {item["district"] for item in records}
    description = f"Справочник строительных и инженерных организаций: {len(records)} профильных карточек по Воронежской области с поиском по названию, адресу и специализации."
    group_cards = "".join(f'<div class="org-purpose-card"><span>0{index}</span><h2>{esc(data["label"])}</h2><p>{esc(data["fit"])}</p></div>' for index, data in enumerate(GROUPS.values(), 1))
    structured = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": canonical, "url": canonical, "name": "Строительный справочник организаций", "description": description, "inLanguage": "ru-RU", "isPartOf": {"@id": DOMAIN + "/#website"}, "publisher": {"@id": DOMAIN + "/#organization"}},
        breadcrumb_schema([("Главная", "/"), ("Организации", url)]),
    ]}
    content = f"""{page_head("Строительный справочник организаций — ГК «ДНЕПР»", description, canonical, structured)}{header()}<main id="main"><section class="org-directory-hero"><div class="container">{breadcrumbs([("Главная", "/"), ("Организации", None)])}<p class="eyebrow light">Каталог для строительных проектов</p><h1>Организации строительного профиля</h1><p>Поиск по отобранным подрядчикам, проектировщикам, поставщикам, инженерным организациям и операторам инфраструктуры.</p><div class="org-hero-metrics"><div><strong>{len(records)}</strong><span>организаций</span></div><div><strong>{len(districts)}</strong><span>района и округа</span></div><div><strong>{len(GROUPS)}</strong><span>профильных направлений</span></div></div></div></section><section class="org-search-section"><div class="container"><div class="org-search-panel"><label for="organization-search">Найти организацию</label><div><input id="organization-search" type="search" minlength="2" autocomplete="off" placeholder="Название, город или профиль"><button type="button" data-organization-search-button>Найти</button></div><p data-organization-search-status>Введите минимум два символа.</p><div class="org-search-results" data-organization-search-results></div><noscript><p>Для поиска включите JavaScript или откройте <a href="/organizations/{REGION_SLUG}/">каталог Воронежской области</a>.</p></noscript></div></div></section><section class="section"><div class="container"><div class="section-head org-section-head"><div><p class="eyebrow">Что включено</p><h2 class="section-title">Только профильные направления</h2></div><p class="section-lead">Автомойки, автосервисы, кафе, магазины одежды, салоны и другие непрофильные организации отсечены до публикации.</p></div><div class="org-purpose-grid">{group_cards}</div><a class="button button-primary org-region-button" href="/organizations/{REGION_SLUG}/">Открыть Воронежскую область <span class="arrow">↗</span></a><div class="org-directory-note"><strong>Важно</strong><p>Это независимый справочный раздел. ГК «ДНЕПР» не представляет перечисленные организации. Контакты нужно подтверждать на сайтах самих организаций.</p></div></div></section></main>{footer(include_search=True)}"""
    return url, content


def write_search_index(target: Path, records: list[dict], generated: str) -> None:
    items = [
        {"name": item["name"], "city": item["city"], "district": item["district"], "profile": ", ".join(item["categories"][:4]), "url": item["url"]}
        for item in records
    ]
    target.write_text(json.dumps({"generated": generated, "count": len(items), "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")


def read_core_sitemap(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    root = ET.parse(path).getroot()
    entries = []
    for node in root:
        values = {child.tag.rsplit("}", 1)[-1]: (child.text or "") for child in node}
        if values.get("loc", "").startswith(DOMAIN + "/organizations/"):
            continue
        if values.get("loc"):
            entries.append(values)
    return entries


def write_sitemap(path: Path, core: list[dict[str, str]], generated: str, organization_urls: list[tuple[str, str, str]]) -> None:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for entry in core:
        parts = [f"<loc>{esc(entry['loc'])}</loc>"]
        for key in ("lastmod", "changefreq", "priority"):
            if entry.get(key):
                parts.append(f"<{key}>{esc(entry[key])}</{key}>")
        lines.append("  <url>" + "".join(parts) + "</url>")
    for url, changefreq, priority in organization_urls:
        lines.append(f"  <url><loc>{esc(DOMAIN + url)}</loc><lastmod>{generated}</lastmod><changefreq>{changefreq}</changefreq><priority>{priority}</priority></url>")
    lines.append("</urlset>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def write_report(path: Path, records: list[dict], rejected: collections.Counter, raw_rows: int, duplicates: int, generated: str) -> None:
    groups = collections.Counter(group for item in records for group in item["groups"])
    districts = collections.Counter(item["district"] for item in records)
    excluded = raw_rows - len(records)
    group_rows = "\n".join(f"| {GROUPS[group]['label']} | {groups[group]} |" for group in GROUPS)
    district_rows = "\n".join(f"| {district} | {count} |" for district, count in sorted(districts.items(), key=lambda pair: pair[0].casefold()))
    report = f"""# Фильтрация организаций Воронежской области

Дата сборки: {generated}

## Результат

- Исходных записей: {raw_rows}
- Опубликовано профильных организаций: {len(records)}
- Исключено: {excluded}
- Удалено дублей после первичного отбора: {duplicates}

## Условия публикации

Карточка публикуется только при одновременном выполнении всех условий:

1. Подрубрика входит в редакционную строительную таксономию.
2. Есть конкретное название организации, район, населённый пункт и полный адрес.
3. Есть полноценный российский телефон и отдельный сайт организации.
4. Название не относится к автомойке, автосервису, шиномонтажу, салону красоты, ремонту телефонов или другому явно непрофильному бизнесу.
5. Запись не дублирует сочетание «название + район + город + адрес».

Отдельные страницы не создаются для записей без проверяемых контактов. Это защищает основной домен от массовых малополезных страниц.

## Причины исключения

| Причина | Количество |
|---|---:|
| Непрофильная или слишком общая запись | {rejected['not_relevant_or_generic']} |
| Нет названия или полного местоположения | {rejected['missing_identity_or_location']} |
| Нет полноценного телефона или отдельного сайта | {rejected['missing_full_phone_or_independent_website']} |
| Дубликат | {duplicates} |

## Профили

| Профиль | Карточек |
|---|---:|
{group_rows}

Одна организация может относиться к нескольким профилям.

## Районы и городские округа

| Район | Организаций |
|---|---:|
{district_rows}

## Публикационная модель

- Главная страница справочника содержит поиск по названию, городу и профилю.
- Страница региона ведёт к отдельным страницам районов и городских округов.
- Внутри района организации распределены по пяти профильным направлениям и разбиты на страницы по 80 записей.
- Каждая организация получает собственный постоянный URL, фактические контактные сведения, ссылку на указанный сайт и явное уведомление, что карточка не является официальным сайтом организации.
- В sitemap включаются только записи, прошедшие фильтр.
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Directory containing district XLSX files")
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    parser.add_argument("--report", type=Path, default=Path(__file__).resolve().parents[1] / "docs" / "organizations" / "voronezh-filter-report.md")
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()

    site = args.site.resolve()
    target = (site / "organizations").resolve()
    if target.parent != site or target.name != "organizations":
        raise SystemExit("Refusing to replace an unexpected directory")

    records, rejected, raw_rows, duplicates = load_records(args.source.resolve())
    if not records:
        raise SystemExit("The filter produced no publishable records")

    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    sitemap_urls: list[tuple[str, str, str]] = []
    generated_label = dt.date.fromisoformat(args.date).strftime("%d.%m.%Y")

    root_url, root_content = root_page(records)
    write_url(site, root_url, root_content)
    sitemap_urls.append((root_url, "weekly", "0.8"))

    region_url, region_content = region_page(records)
    write_url(site, region_url, region_content)
    sitemap_urls.append((region_url, "weekly", "0.8"))

    by_district = collections.defaultdict(list)
    for item in records:
        by_district[item["district"]].append(item)

    for district, district_items in sorted(by_district.items(), key=lambda pair: pair[0].casefold()):
        url, content = district_page(district, district_items)
        write_url(site, url, content)
        sitemap_urls.append((url, "monthly", "0.7"))
        for group in GROUPS:
            group_items = [item for item in district_items if group in item["groups"]]
            if not group_items:
                continue
            pages = math.ceil(len(group_items) / PAGE_SIZE)
            for page in range(1, pages + 1):
                url, content = listing_page(district, district_items[0]["district_slug"], group, group_items, page, pages)
                write_url(site, url, content)
                sitemap_urls.append((url, "monthly", "0.6"))

    for item in records:
        write_url(site, item["url"], company_page(item, generated_label))
        sitemap_urls.append((item["url"], "yearly", "0.5"))

    write_search_index(target / "index.json", records, args.date)
    core = read_core_sitemap(site / "sitemap.xml")
    write_sitemap(site / "sitemap.xml", core, args.date, sitemap_urls)
    write_report(args.report, records, rejected, raw_rows, duplicates, args.date)

    print(json.dumps({
        "source_rows": raw_rows,
        "published_organizations": len(records),
        "districts": len(by_district),
        "directory_urls": len(sitemap_urls),
        "rejected": rejected,
        "duplicates": duplicates,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
