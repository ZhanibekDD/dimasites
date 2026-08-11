#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
import sys

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

errors = []
canonical_urls = []
for page in ROOT.rglob("*.html"):
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
    ROOT / "api" / "fns-company.php",
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
]
for item in required:
    if not item.exists(): errors.append(f"missing required file: {item.name}")

gateway = (ROOT / "api" / "fns-company.php").read_text(encoding="utf-8")
for marker in ("officialFields", "documents", "rsmppdf", "puchdocurl", "gosregurl", "counts"):
    if marker not in gateway:
        errors.append(f"fns-company.php: missing full-response marker {marker}")

contact_gateway = (ROOT / "contact.php").read_text(encoding="utf-8")
for marker in ("calculate_lead_score", "create_lead_id", "store_lead", "lead_score", "dnepr-private"):
    if marker not in contact_gateway:
        errors.append(f"contact.php: missing production lead marker {marker}")
if "+7 (3496) 43-57-67" in contact_gateway:
    errors.append("contact.php: obsolete fallback phone remains")

admin_gateway = (ROOT / "admin" / "index.php").read_text(encoding="utf-8")
for marker in ("secure_equals_legacy", "dnepr-private", "lead-status-", "format'] === 'csv'", "noindex"):
    if marker not in admin_gateway:
        errors.append(f"admin/index.php: missing protected lead console marker {marker}")

admin_setup = (ROOT.parent / "scripts" / "timeweb_setup_admin.sh").read_text(encoding="utf-8")
for marker in ("/dev/urandom", "password_hash", "chmod 0600", "shown only once"):
    if marker not in admin_setup:
        errors.append(f"timeweb_setup_admin.sh: missing secure setup marker {marker}")

main_js = (ROOT / "assets" / "js" / "main.js").read_text(encoding="utf-8")
for marker in ("lead_id", "lead_score", "lead_priority"):
    if marker not in main_js:
        errors.append(f"main.js: missing lead analytics marker {marker}")

navigator_js = (ROOT / "assets" / "js" / "navigator.js").read_text(encoding="utf-8")
for marker in ("navigator_route_created", "officialSources", "downloadReport", "отсутствие записи"):
    if marker not in navigator_js:
        errors.append(f"navigator.js: missing production navigator marker {marker}")

search_source = (ROOT.parent / "src" / "stroypoisk.js").read_text(encoding="utf-8")
if "sources: ['fns-profile', 'egrz', 'eis']" not in search_source:
    errors.append("stroypoisk.js: company route must contain one FNS source without duplicate extract card")
for marker in ("Все поля ответа ФНС", "company-documents", "safeOfficialHref"):
    if marker not in search_source:
        errors.append(f"stroypoisk.js: missing full FNS result UI marker {marker}")

about_html = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
projects_html = (ROOT / "projects" / "index.html").read_text(encoding="utf-8")
for page_name, content in (("about/index.html", about_html), ("projects/index.html", projects_html)):
    if "sports-court.svg" in content or "stadium-stands.svg" in content:
        errors.append(f"{page_name}: schematic image remains where a real company photo is required")

for page in ROOT.rglob("*.html"):
    if page.name == "404.html":
        continue
    content = page.read_text(encoding="utf-8")
    if "/assets/js/main.js?v=20260811-lead1" not in content:
        errors.append(f"{page.relative_to(ROOT)}: stale main.js cache version")

sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8") if (ROOT / "sitemap.xml").exists() else ""
for rel, canonical in canonical_urls:
    if f"<loc>{canonical}</loc>" not in sitemap:
        errors.append(f"{rel}: canonical URL is missing from sitemap.xml")

if errors:
    print("Site check failed:")
    for error in errors: print(f"- {error}")
    sys.exit(1)
print(f"Site check passed: {len(list(ROOT.rglob('*.html')))} HTML pages")
