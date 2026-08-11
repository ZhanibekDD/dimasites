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
    ROOT / "api" / "fns-company.php",
    ROOT / "proverka" / "index.html",
    ROOT / "proverka" / "poisk" / "index.html",
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

sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8") if (ROOT / "sitemap.xml").exists() else ""
for rel, canonical in canonical_urls:
    if f"<loc>{canonical}</loc>" not in sitemap:
        errors.append(f"{rel}: canonical URL is missing from sitemap.xml")

if errors:
    print("Site check failed:")
    for error in errors: print(f"- {error}")
    sys.exit(1)
print(f"Site check passed: {len(list(ROOT.rglob('*.html')))} HTML pages")
