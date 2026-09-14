#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
import json
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1] / "site"

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.lang = None
        self.title = False
        self.description = False
        self.canonical = False
        self.canonical_url = None
        self.h1 = 0
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "html": self.lang = data.get("lang")
        if tag == "title": self.title = True
        if tag == "meta" and data.get("name") == "description": self.description = bool(data.get("content"))
        if tag == "link" and data.get("rel") == "canonical":
            self.canonical_url = data.get("href")
            self.canonical = bool(self.canonical_url)
        if tag == "h1": self.h1 += 1
        for key in ("href", "src", "action"):
            if key in data: self.links.append(data[key])

def target_exists(value: str) -> bool:
    if not value or value.startswith(("#", "mailto:", "tel:", "data:")): return True
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc: return True
    path = parsed.path
    if not path.startswith("/"): return True
    target = ROOT / path.lstrip("/")
    if path.endswith("/"): target = target / "index.html"
    return target.exists()

def is_technical_html(page: Path) -> bool:
    return page.parent == ROOT and page.name.startswith("yandex_")

errors = []
canonical_urls = []
for page in ROOT.rglob("*.html"):
    if is_technical_html(page):
        continue
    parser = Parser()
    parser.feed(page.read_text(encoding="utf-8"))
    rel = page.relative_to(ROOT)
    if parser.lang != "ru": errors.append(f"{rel}: html lang must be ru")
    if not parser.title: errors.append(f"{rel}: missing title")
    if page.name != "404.html":
        if not parser.description: errors.append(f"{rel}: missing meta description")
        if not parser.canonical: errors.append(f"{rel}: missing canonical")
        elif parser.canonical_url: canonical_urls.append((rel, parser.canonical_url))
    if parser.h1 != 1: errors.append(f"{rel}: expected exactly one h1, got {parser.h1}")
    for link in parser.links:
        if not target_exists(link): errors.append(f"{rel}: broken internal target {link}")

required = [
    ROOT / "robots.txt",
    ROOT / "sitemap.xml",
    ROOT / ".htaccess",
    ROOT / "contact.php",
    ROOT / "admin" / "index.php",
    ROOT / "assets" / "css" / "admin.css",
    ROOT / "assets" / "css" / "admin-sources.css",
    ROOT / "api" / "fns-company.php",
    ROOT / "api" / "source-common.php",
    ROOT / "api" / "source-search.php",
    ROOT / "api" / "release.php",
    ROOT / "proverka" / "index.html",
    ROOT / "proverka" / "poisk" / "index.html",
    ROOT / "proverka" / "navigator" / "index.html",
    ROOT / "assets" / "js" / "navigator.js",
    ROOT / "assets" / "css" / "navigator.css",
    ROOT / "assets" / "js" / "proverka.bundle.js",
    ROOT / "assets" / "js" / "stroypoisk.bundle.js",
    ROOT / "assets" / "vendor" / "pdfjs" / "pdf.min.mjs",
    ROOT / "assets" / "vendor" / "pdfjs" / "pdf.worker.min.mjs",
    ROOT / "assets" / "vendor" / "tesseract" / "worker.min.js",
    ROOT / "assets" / "vendor" / "tesseract" / "core" / "tesseract-core-lstm.js",
    ROOT / "assets" / "vendor" / "tesseract" / "core" / "tesseract-core-lstm.wasm",
    ROOT / "assets" / "vendor" / "tesseract" / "lang" / "rus.traineddata.gz",
    ROOT / "assets" / "vendor" / "tesseract" / "lang" / "eng.traineddata.gz",
    ROOT / "organizations",
    ROOT / "assets" / "css" / "organizations.css",
]
for item in required:
    if not item.exists(): errors.append(f"missing required file: {item.name}")

gateway = (ROOT / "api" / "fns-company.php").read_text(encoding="utf-8")
for marker in ("officialFields", "documents", "rsmppdf", "puchdocurl", "gosregurl", "counts", "dnepr_egrul_fallback_search", "egrul.nalog.ru/search-result/"):
    if marker not in gateway:
        errors.append(f"fns-company.php: missing full-response marker {marker}")

contact_gateway = (ROOT / "contact.php").read_text(encoding="utf-8")
for marker in ("calculate_lead_score", "create_lead_id", "store_lead", "lead_score", "dnepr-private"):
    if marker not in contact_gateway:
        errors.append(f"contact.php: missing production lead marker {marker}")
if "+7 (3496) 43-57-67" in contact_gateway:
    errors.append("contact.php: obsolete fallback phone remains")

admin_gateway = (ROOT / "admin" / "index.php").read_text(encoding="utf-8")
for marker in ("secure_equals_legacy", "load_admin_config", ".access.php", "admin.json", "dnepr-private", "lead-status-", "source-query-", "format'] === 'sources'", "format'] === 'csv'", "csv_safe_value", "curl_code", "stage", "noindex"):
    if marker not in admin_gateway:
        errors.append(f"admin/index.php: missing protected lead console marker {marker}")

admin_setup = (ROOT.parent / "scripts" / "timeweb_setup_admin.sh").read_text(encoding="utf-8")
for marker in ("/dev/urandom", "admin.json", ".access.php", "password_hash", "chmod 0600", "shown only once"):
    if marker not in admin_setup:
        errors.append(f"timeweb_setup_admin.sh: missing secure setup marker {marker}")

main_js = (ROOT / "assets" / "js" / "main.js").read_text(encoding="utf-8")
for marker in (
    "lead_id",
    "lead_score",
    "lead_priority",
    "phone_click",
    "form_start",
    "utm_medium",
    "landing_page",
):
    if marker not in main_js:
        errors.append(f"main.js: missing lead analytics marker {marker}")

navigator_js = (ROOT / "assets" / "js" / "navigator.js").read_text(encoding="utf-8")
for marker in ("navigator_route_created", "officialSources", "downloadReport", "отсутствие записи"):
    if marker not in navigator_js:
        errors.append(f"navigator.js: missing production navigator marker {marker}")

search_source = (ROOT.parent / "src" / "stroypoisk.js").read_text(encoding="utf-8")
if "sources: ['fns-profile', 'egrz', 'eis']" not in search_source:
    errors.append("stroypoisk.js: company route must contain one FNS source without duplicate extract card")
for marker in ("Все поля ответа ФНС", "company-documents", "safeOfficialHref", "fetchRegistrySource", "renderSourceReport", "sourceReportSectionHtml"):
    if marker not in search_source:
        errors.append(f"stroypoisk.js: missing full FNS result UI marker {marker}")

registry_gateway = (ROOT / "api" / "source-search.php").read_text(encoding="utf-8")
for marker in ("source_parse_eis", "source_parse_egrz", "dnepr_source_http_post", "official-documents-page", "explicit_empty", "response-validation", "diagnosticId"):
    if marker not in registry_gateway:
        errors.append(f"source-search.php: missing official registry adapter marker {marker}")

about_html = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
projects_html = (ROOT / "projects" / "index.html").read_text(encoding="utf-8")
for page_name, content in (("about/index.html", about_html), ("projects/index.html", projects_html)):
    if "sports-court.svg" in content or "stadium-stands.svg" in content:
        errors.append(f"{page_name}: schematic image remains where a real company photo is required")

for page in ROOT.rglob("*.html"):
    if page.name == "404.html" or is_technical_html(page):
        continue
    content = page.read_text(encoding="utf-8")
    if "/assets/js/main.js?v=20260813-seo1" not in content:
        errors.append(f"{page.relative_to(ROOT)}: stale main.js cache version")

sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8") if (ROOT / "sitemap.xml").exists() else ""
try:
    sitemap_root = ET.fromstring(sitemap)
    sitemap_urls = {
        (child.text or "").strip()
        for node in sitemap_root
        for child in node
        if child.tag.rsplit("}", 1)[-1] == "loc"
    }
except ET.ParseError as exc:
    sitemap_urls = set()
    errors.append(f"sitemap.xml: invalid XML: {exc}")
for rel, canonical in canonical_urls:
    if canonical not in sitemap_urls:
        errors.append(f"{rel}: canonical URL is missing from sitemap.xml")

forbidden_organization_name = re.compile(
    r"автомойк|автосервис|шиномонтаж|автотехцентр|автоцентр|детейлинг|"
    r"^\s*жк\b|жилой комплекс|новостройк|паспортн(?:ый|ого) стол|магазин цифровой|"
    r"бытовой техник|магазин мототехники|велосипед|автоэмал|\bфаркоп|"
    r"продуктовая компания|защита растений|агродрон|^\s*корма\s*$|\bсто кормов\b",
    re.IGNORECASE,
)
profile_pages = 0
for page in (ROOT / "organizations").rglob("index.html") if (ROOT / "organizations").exists() else []:
    content = page.read_text(encoding="utf-8")
    if 'class="org-profile-hero"' not in content:
        continue
    profile_pages += 1
    for marker in ("Независимая справочная карточка", "ГК «ДНЕПР» не является представителем", "Что проверить перед обращением", "Реклама · ГК «ДНЕПР»"):
        if marker not in content:
            errors.append(f"{page.relative_to(ROOT)}: missing organization transparency marker {marker}")
    if content.count('class="org-content-card org-contact-details-card"') != 1:
        errors.append(f"{page.relative_to(ROOT)}: organization details must be grouped in one contact card")
    if 'class="org-quick-card"' in content:
        errors.append(f"{page.relative_to(ROOT)}: obsolete separate quick-contact card remains")
    for marker in ("Телефон организации", "Сайт организации", "Перейти на сайт", "Организация на карте", "Открыть большую карту", "Организация", "Адрес", "Район"):
        if marker not in content:
            errors.append(f"{page.relative_to(ROOT)}: unified organization card is missing {marker}")
    if content.count('class="org-map-frame"') != 1:
        errors.append(f"{page.relative_to(ROOT)}: organization profile must contain one embedded map")
    name_match = re.search(r'<h1(?:\s+[^>]*)?>([^<]+)</h1>', content)
    if name_match and forbidden_organization_name.search(name_match.group(1)):
        errors.append(f"{page.relative_to(ROOT)}: irrelevant organization profile remains: {name_match.group(1)}")
if profile_pages < 100:
    errors.append(f"organizations: unexpectedly small curated profile set ({profile_pages})")
if (ROOT / "organizations" / "index.html").exists():
    errors.append("organizations: public directory root must not be generated")
if 'href="/organizations/"' in (ROOT / "index.html").read_text(encoding="utf-8"):
    errors.append("index.html: organization directory link must not appear on the home page")

if errors:
    print("Site check failed:")
    for error in errors: print(f"- {error}")
    sys.exit(1)
print(f"Site check passed: {len(list(ROOT.rglob('*.html')))} HTML pages")
