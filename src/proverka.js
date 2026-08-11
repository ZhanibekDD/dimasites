import mammoth from 'mammoth';
import { unzipSync, strFromU8 } from 'fflate';
import { createWorker } from 'tesseract.js';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 60;
const MIN_PDF_TEXT = 140;
const MAX_ZIP_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_ZIP_ENTRY = 20 * 1024 * 1024;

const ui = {
  app: document.querySelector('[data-document-analyzer]'),
  input: document.querySelector('[data-file-input]'),
  dropzone: document.querySelector('[data-dropzone]'),
  choose: document.querySelector('[data-file-choose]'),
  start: document.querySelector('[data-analysis-start]'),
  cancel: document.querySelector('[data-analysis-cancel]'),
  reset: document.querySelectorAll('[data-analysis-reset]'),
  fileCard: document.querySelector('[data-file-card]'),
  fileName: document.querySelector('[data-file-name]'),
  fileMeta: document.querySelector('[data-file-meta]'),
  error: document.querySelector('[data-analysis-error]'),
  process: document.querySelector('[data-analysis-process]'),
  progress: document.querySelector('[data-analysis-progress]'),
  progressLabel: document.querySelector('[data-progress-label]'),
  progressValue: document.querySelector('[data-progress-value]'),
  processDetail: document.querySelector('[data-process-detail]'),
  result: document.querySelector('[data-analysis-result]'),
  resultTitle: document.querySelector('[data-result-title]'),
  resultLead: document.querySelector('[data-result-lead]'),
  countFindings: document.querySelector('[data-count-findings]'),
  countPages: document.querySelector('[data-count-pages]'),
  countEvidence: document.querySelector('[data-count-evidence]'),
  categoryBars: document.querySelector('[data-category-bars]'),
  filters: document.querySelector('[data-finding-filters]'),
  findings: document.querySelector('[data-findings]'),
  findingsEmpty: document.querySelector('[data-findings-empty]'),
  findingsShown: document.querySelector('[data-findings-shown]'),
  exportJson: document.querySelector('[data-export-json]'),
  exportCsv: document.querySelector('[data-export-csv]'),
  exportHtml: document.querySelector('[data-export-html]'),
  leadForm: document.querySelector('[data-analysis-lead-form]'),
  leadMessage: document.querySelector('[data-analysis-lead-message]'),
};

if (!ui.app) {
  throw new Error('Document analyzer root was not found.');
}

let selectedFile = null;
let ocrWorker = null;
let running = false;
let cancelled = false;
let analysis = null;
let activeFilter = 'all';

const categories = [
  {
    id: 'project',
    name: 'Проектные решения',
    short: 'Проект',
    color: '#ffd229',
    patterns: [/проектн\w*\s+(?:решен|документ|материал)/i, /черт[её]ж/i, /раздел\w*\s+(?:проект|пд|рд)/i, /расч[её]т\w*/i, /конструктив/i, /схем\w*\s+(?:планиров|располож|подключ)/i],
  },
  {
    id: 'ird',
    name: 'Исходно-разрешительная документация',
    short: 'ИРД',
    color: '#75a9ff',
    patterns: [/исходн\w*[-\s]+разрешитель/i, /техническ\w*\s+услов/i, /гпзу/i, /прав\w*\s+(?:на|пользован)\s+(?:зем|участ)/i, /разрешен\w*\s+на\s+строитель/i, /согласован\w*/i, /градостроитель/i],
  },
  {
    id: 'safety',
    name: 'Безопасность и нормы',
    short: 'Безопасность',
    color: '#ff7a68',
    patterns: [/пожарн\w*/i, /промышленн\w*\s+безопасност/i, /санитарн\w*/i, /охран\w*\s+труд/i, /эколог\w*/i, /нормативн\w*\s+(?:требован|документ)/i, /сп\s*\d/i, /федеральн\w*\s+закон/i],
  },
  {
    id: 'survey',
    name: 'Изыскания и инженерные расчёты',
    short: 'Изыскания',
    color: '#74d7b2',
    patterns: [/изыскан\w*/i, /геолог\w*/i, /геодез\w*/i, /нагруз\w*/i, /прочност\w*/i, /гидравлическ\w*\s+расч[её]т/i, /инженерн\w*\s+(?:расч|обслед)/i, /несущ\w*\s+способност/i],
  },
  {
    id: 'estimate',
    name: 'Сметы и объёмы',
    short: 'Сметы',
    color: '#c79cff',
    patterns: [/смет\w*/i, /стоимост\w*/i, /ведомост\w*\s+объ[её]м/i, /объ[её]м\w*\s+работ/i, /расценк\w*/i],
  },
  {
    id: 'formal',
    name: 'Оформление и комплектность',
    short: 'Оформление',
    color: '#a4afbb',
    patterns: [/подпис\w*/i, /печат\w*/i, /оформлен\w*/i, /нумерац\w*/i, /комплектност\w*/i, /титульн\w*\s+лист/i, /приложен\w*/i, /представлен\w*\s+не\s+в\s+полн/i],
  },
  {
    id: 'other',
    name: 'Прочие требования',
    short: 'Прочее',
    color: '#d5d0c6',
    patterns: [],
  },
];

const triggerRules = [
  { label: 'не соответствует', pattern: /не\s+соответств\w*/i, strong: true },
  { label: 'отсутствует', pattern: /отсутств\w*/i, strong: true },
  { label: 'не представлен', pattern: /не\s+представлен\w*/i, strong: true },
  { label: 'не выполнен', pattern: /не\s+выполн\w*/i, strong: true },
  { label: 'нарушение', pattern: /наруш\w*/i, strong: true },
  { label: 'отказ', pattern: /отказ\w*/i, strong: true },
  { label: 'предписание', pattern: /предписан\w*/i, strong: true },
  { label: 'замечание', pattern: /замечан\w*/i, strong: true },
  { label: 'устранить', pattern: /устран\w*/i, strong: true },
  { label: 'скорректировать', pattern: /скорректир\w*/i, strong: true },
  { label: 'доработать', pattern: /доработ\w*/i, strong: true },
  { label: 'требуется', pattern: /требу(?:ется|ются|емый|емая|емые)/i, strong: false },
  { label: 'необходимо', pattern: /необходим\w*/i, strong: false },
  { label: 'следует', pattern: /следует/i, strong: false },
  { label: 'уточнить', pattern: /уточн(?:ить|ите|ение)/i, strong: false },
  { label: 'предоставить', pattern: /предостав(?:ить|ьте|лен)/i, strong: false },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00ad/g, '')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function setError(message = '') {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function setProgress(percent, label, detail = '') {
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  ui.progress.style.setProperty('--analysis-progress', `${safe}%`);
  ui.progressValue.textContent = `${safe}%`;
  ui.progressLabel.textContent = label;
  ui.processDetail.textContent = detail;
}

function showProcess() {
  ui.fileCard.hidden = true;
  ui.result.hidden = true;
  ui.process.hidden = false;
  setError();
}

function showFile(file, kind) {
  ui.fileCard.hidden = false;
  ui.process.hidden = true;
  ui.result.hidden = true;
  ui.fileName.textContent = file.name;
  ui.fileMeta.textContent = `${kind.label} · ${formatBytes(file.size)} · обработка только на этом устройстве`;
  ui.start.disabled = false;
  setError();
}

function resetAnalyzer() {
  if (running) return;
  selectedFile = null;
  analysis = null;
  activeFilter = 'all';
  ui.input.value = '';
  ui.fileCard.hidden = true;
  ui.process.hidden = true;
  ui.result.hidden = true;
  ui.start.disabled = true;
  setError();
  ui.dropzone.focus();
}

async function detectKind(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = Array.from(head).map((value) => value.toString(16).padStart(2, '0')).join('');
  const ascii = String.fromCharCode(...head);

  if (ascii.startsWith('%PDF-') && extension === 'pdf') return { id: 'pdf', label: 'PDF' };
  if (signature.startsWith('89504e470d0a1a0a') && extension === 'png') return { id: 'image', label: 'PNG' };
  if (signature.startsWith('ffd8ff') && ['jpg', 'jpeg'].includes(extension)) return { id: 'image', label: 'JPEG' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' && extension === 'webp') return { id: 'image', label: 'WebP' };
  if (signature.startsWith('504b0304') && extension === 'docx') return { id: 'docx', label: 'DOCX' };
  if (signature.startsWith('504b0304') && extension === 'xlsx') return { id: 'xlsx', label: 'XLSX' };

  throw new Error('Формат или содержимое файла не совпадают. Поддерживаются PDF, DOCX, XLSX, PNG, JPG и WebP.');
}

async function acceptFile(file) {
  if (!file) return;
  if (file.size === 0) {
    setError('Файл пустой. Выберите документ с содержимым.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setError(`Файл больше ${formatBytes(MAX_FILE_BYTES)}. Уменьшите его размер или разделите документ.`);
    return;
  }
  try {
    const kind = await detectKind(file);
    selectedFile = { file, kind };
    showFile(file, kind);
  } catch (error) {
    selectedFile = null;
    ui.fileCard.hidden = true;
    setError(error.message);
  }
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  setProgress(8, 'Подготовка OCR', 'Первый запуск загружает локальные русские и английские языковые модели.');
  ocrWorker = await createWorker(['rus', 'eng'], 1, {
    workerPath: '/assets/vendor/tesseract/worker.min.js',
    corePath: '/assets/vendor/tesseract/core/tesseract-core-lstm.js',
    langPath: '/assets/vendor/tesseract/lang',
    logger: (event) => {
      if (event.status === 'recognizing text' && Number.isFinite(event.progress)) {
        ui.processDetail.textContent = `Распознавание текста: ${Math.round(event.progress * 100)}% текущей страницы`;
      }
    },
    workerBlobURL: false,
  });
  await ocrWorker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return ocrWorker;
}

function validateOfficeArchive(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let entries = 0;
  let totalUncompressed = 0;
  for (let offset = 0; offset <= view.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries += 1;
    totalUncompressed += uncompressed;
    if (uncompressed > MAX_ZIP_ENTRY) throw new Error('В документе найден слишком большой внутренний файл. Разделите документ и попробуйте снова.');
    if (uncompressed > 5 * 1024 * 1024 && compressed > 0 && uncompressed / compressed > 300) {
      throw new Error('Архив документа имеет небезопасную степень сжатия. Пересохраните файл в Word или Excel.');
    }
    if (entries > 5000 || totalUncompressed > MAX_ZIP_UNCOMPRESSED) {
      throw new Error('Распакованный документ слишком большой для безопасной обработки в браузере.');
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!entries) throw new Error('Не удалось проверить структуру офисного документа. Возможно, файл повреждён.');
}

async function ocrCanvas(canvas, label) {
  if (cancelled) throw new Error('Анализ отменён пользователем.');
  const worker = await getOcrWorker();
  ui.processDetail.textContent = `OCR: ${label}`;
  const result = await worker.recognize(canvas);
  return {
    text: cleanText(result.data.text),
    confidence: Number(result.data.confidence || 0),
  };
}

async function extractPdf(file) {
  const pdfjs = await import('/assets/vendor/pdfjs/pdf.min.mjs?v=20260811');
  pdfjs.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.mjs?v=20260811';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const pdfDocument = await task.promise;
  const totalUnits = pdfDocument.numPages;
  const count = Math.min(totalUnits, MAX_PDF_PAGES);
  const pages = [];

  for (let index = 1; index <= count; index += 1) {
    if (cancelled) throw new Error('Анализ отменён пользователем.');
    setProgress(10 + (index - 1) / count * 65, 'Чтение PDF', `Страница ${index} из ${count}`);
    const page = await pdfDocument.getPage(index);
    const content = await page.getTextContent({ disableNormalization: false });
    let text = cleanText(content.items.map((item) => item.str).join(' '));
    let method = 'embedded-text';
    let confidence = 100;

    if (text.length < MIN_PDF_TEXT) {
      const baseViewport = page.getViewport({ scale: 1 });
      const safeScale = Math.max(.1, Math.min(2, 2800 / Math.max(baseViewport.width, baseViewport.height), Math.sqrt(10_000_000 / (baseViewport.width * baseViewport.height))));
      const viewport = page.getViewport({ scale: safeScale });
      const canvas = window.document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      const recognized = await ocrCanvas(canvas, `страница ${index} из ${count}`);
      if (recognized.text.length > text.length) {
        text = recognized.text;
        confidence = recognized.confidence;
        method = 'ocr';
      }
      canvas.width = 1;
      canvas.height = 1;
    }

    pages.push({ label: `Страница ${index}`, text, method, confidence });
    page.cleanup();
  }

  await pdfDocument.destroy();
  return {
    pages,
    totalUnits,
    truncated: totalUnits > MAX_PDF_PAGES,
    format: 'PDF',
  };
}

async function extractDocx(file) {
  setProgress(22, 'Чтение DOCX', 'Извлекаем текст из структуры документа Word.');
  const arrayBuffer = await file.arrayBuffer();
  validateOfficeArchive(arrayBuffer);
  const output = await mammoth.extractRawText({ arrayBuffer });
  const paragraphs = cleanText(output.value).split(/\n{2,}/).filter(Boolean);
  const pages = [];
  for (let index = 0; index < paragraphs.length; index += 35) {
    pages.push({
      label: `Блок ${Math.floor(index / 35) + 1}`,
      text: paragraphs.slice(index, index + 35).join('\n'),
      method: 'document-structure',
      confidence: 100,
    });
  }
  if (!pages.length) pages.push({ label: 'Документ', text: '', method: 'document-structure', confidence: 100 });
  return { pages, totalUnits: pages.length, truncated: false, format: 'DOCX', warnings: output.messages.length };
}

function xmlDocument(bytes) {
  const value = strFromU8(bytes);
  const parsed = new DOMParser().parseFromString(value, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('Не удалось прочитать структуру XLSX.');
  return parsed;
}

function childText(node, name) {
  const match = Array.from(node.children || []).find((child) => child.localName === name);
  return match?.textContent || '';
}

function elementsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter((node) => node.localName === name || node.tagName === name);
}

async function extractXlsx(file) {
  setProgress(20, 'Чтение XLSX', 'Извлекаем значения ячеек и названия листов.');
  const arrayBuffer = await file.arrayBuffer();
  validateOfficeArchive(arrayBuffer);
  const zip = unzipSync(new Uint8Array(arrayBuffer));
  if (!zip['xl/workbook.xml'] || !zip['xl/_rels/workbook.xml.rels']) {
    throw new Error('В файле не найдена структура рабочей книги XLSX.');
  }

  const shared = zip['xl/sharedStrings.xml']
    ? elementsByLocalName(xmlDocument(zip['xl/sharedStrings.xml']), 'si')
      .map((item) => elementsByLocalName(item, 't').map((node) => node.textContent || '').join(''))
    : [];
  const workbook = xmlDocument(zip['xl/workbook.xml']);
  const relationships = xmlDocument(zip['xl/_rels/workbook.xml.rels']);
  const targetById = new Map(
    elementsByLocalName(relationships, 'Relationship')
      .map((node) => [node.getAttribute('Id'), node.getAttribute('Target')]),
  );
  const sheets = elementsByLocalName(workbook, 'sheet');
  const pages = [];

  sheets.forEach((sheet, sheetIndex) => {
    const relationId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targetById.get(relationId);
    if (!target) return;
    const normalizedTarget = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`.replace(/\/[^/]+\/\.\.\//g, '/');
    const bytes = zip[normalizedTarget];
    if (!bytes) return;
    const sheetXml = xmlDocument(bytes);
    const rows = elementsByLocalName(sheetXml, 'row').map((row) => {
      const values = elementsByLocalName(row, 'c').map((cell) => {
        const ref = cell.getAttribute('r') || '';
        const type = cell.getAttribute('t');
        const raw = childText(cell, 'v');
        let value = raw;
        if (type === 's') value = shared[Number(raw)] || '';
        if (type === 'inlineStr') value = elementsByLocalName(cell, 't').map((node) => node.textContent || '').join('');
        if (type === 'b') value = raw === '1' ? 'Да' : 'Нет';
        return value ? `${ref}: ${value}` : '';
      }).filter(Boolean);
      return values.join(' | ');
    }).filter(Boolean);
    pages.push({
      label: `Лист «${sheet.getAttribute('name') || sheetIndex + 1}»`,
      text: cleanText(rows.join('\n')),
      method: 'spreadsheet-structure',
      confidence: 100,
    });
  });

  if (!pages.length) throw new Error('В книге XLSX не найдено доступных для чтения листов.');
  return { pages, totalUnits: pages.length, truncated: false, format: 'XLSX' };
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Не удалось декодировать изображение.'));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 45_000_000) {
      throw new Error('Разрешение изображения слишком велико. Уменьшите его до 45 мегапикселей.');
    }
    const maxSide = 2600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractImage(file) {
  setProgress(12, 'Подготовка изображения', 'Оптимизируем изображение для распознавания текста.');
  const canvas = await loadImage(file);
  const recognized = await ocrCanvas(canvas, 'изображение');
  canvas.width = 1;
  canvas.height = 1;
  return {
    pages: [{ label: 'Изображение', text: recognized.text, method: 'ocr', confidence: recognized.confidence }],
    totalUnits: 1,
    truncated: false,
    format: 'Изображение',
  };
}

function splitSegments(text) {
  const lines = cleanText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const segments = [];
  let buffer = '';

  const flush = () => {
    const value = buffer.trim();
    if (value.length >= 12) segments.push(value);
    buffer = '';
  };

  lines.forEach((line) => {
    const numbered = /^(?:\d+(?:\.\d+)*[.)]?|[-–—•])\s+/.test(line);
    if (numbered && buffer) flush();
    buffer = buffer ? `${buffer} ${line}` : line;
    if (buffer.length > 220 || /[.!?;:]$/.test(line)) flush();
    if (buffer.length > 700) flush();
  });
  flush();

  return segments.flatMap((segment) => {
    if (segment.length <= 700) return [segment];
    return segment.match(/.{1,650}(?:[.!?;:]\s|$)/g) || [segment.slice(0, 700)];
  });
}

function classifyCategory(segment) {
  let best = categories[categories.length - 1];
  let bestScore = 0;
  categories.slice(0, -1).forEach((category) => {
    const score = category.patterns.reduce((sum, pattern) => sum + (pattern.test(segment) ? 1 : 0), 0);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  });
  return best;
}

function buildFindings(pages) {
  const findings = [];
  const seen = new Set();

  pages.forEach((page) => {
    splitSegments(page.text).forEach((segment) => {
      const matches = triggerRules.filter((rule) => rule.pattern.test(segment));
      if (!matches.length) return;
      if (segment.length < 45 && matches.every((match) => ['замечание', 'отказ'].includes(match.label))) return;
      const normalized = segment.toLowerCase().replace(/[^а-яёa-z0-9]+/gi, ' ').trim().slice(0, 180);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);

      const category = classifyCategory(segment);
      const hasStrong = matches.some((match) => match.strong);
      let confidence = hasStrong ? 'B' : 'C';
      if (page.method === 'ocr' && page.confidence < 68) confidence = 'D';

      findings.push({
        id: `F-${String(findings.length + 1).padStart(3, '0')}`,
        category: category.id,
        categoryName: category.name,
        location: page.label,
        excerpt: segment.slice(0, 700),
        trigger: matches.map((match) => match.label).filter((value, index, list) => list.indexOf(value) === index).slice(0, 3),
        confidence,
        extraction: page.method,
        ocrConfidence: page.method === 'ocr' ? Math.round(page.confidence) : null,
      });
    });
  });

  const order = { B: 0, C: 1, D: 2 };
  return findings.sort((left, right) => order[left.confidence] - order[right.confidence]);
}

function summarizeCategories(findings) {
  return categories.map((category) => ({
    ...category,
    count: findings.filter((finding) => finding.category === category.id).length,
  })).filter((category) => category.count > 0);
}

function renderCategoryBars(summary, total) {
  ui.categoryBars.replaceChildren();
  if (!summary.length) {
    const empty = document.createElement('p');
    empty.className = 'analysis-muted';
    empty.textContent = 'Категории появятся, когда в тексте будут найдены фрагменты с признаками требований или замечаний.';
    ui.categoryBars.append(empty);
    return;
  }
  summary.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-bar';
    const head = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = item.name;
    const value = document.createElement('strong');
    value.textContent = String(item.count);
    head.append(name, value);
    const track = document.createElement('div');
    const fill = document.createElement('i');
    fill.style.setProperty('--category-width', `${Math.max(5, item.count / total * 100)}%`);
    fill.style.setProperty('--category-color', item.color);
    track.append(fill);
    row.append(head, track);
    ui.categoryBars.append(row);
  });
}

function renderFilters(summary) {
  ui.filters.replaceChildren();
  const all = [{ id: 'all', short: 'Все', count: analysis.findings.length }, ...summary];
  all.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'finding-filter';
    button.dataset.filter = item.id;
    button.setAttribute('aria-pressed', String(activeFilter === item.id));
    button.textContent = `${item.short} · ${item.count}`;
    button.addEventListener('click', () => {
      activeFilter = item.id;
      renderFilters(summary);
      renderFindings();
    });
    ui.filters.append(button);
  });
}

function renderFindings() {
  const filtered = activeFilter === 'all'
    ? analysis.findings
    : analysis.findings.filter((finding) => finding.category === activeFilter);
  ui.findings.replaceChildren();
  ui.findingsEmpty.hidden = filtered.length !== 0;
  ui.findingsShown.textContent = `${filtered.length} из ${analysis.findings.length}`;

  filtered.forEach((finding) => {
    const article = document.createElement('article');
    article.className = 'finding-card';

    const head = document.createElement('div');
    head.className = 'finding-card-head';
    const index = document.createElement('span');
    index.className = 'finding-id';
    index.textContent = finding.id;
    const category = document.createElement('strong');
    category.textContent = finding.categoryName;
    const badge = document.createElement('span');
    badge.className = `confidence confidence-${finding.confidence.toLowerCase()}`;
    badge.textContent = `Уровень ${finding.confidence}`;
    head.append(index, category, badge);

    const quote = document.createElement('blockquote');
    quote.textContent = finding.excerpt;

    const meta = document.createElement('div');
    meta.className = 'finding-meta';
    const location = document.createElement('span');
    location.textContent = finding.location;
    const trigger = document.createElement('span');
    trigger.textContent = `Признак: ${finding.trigger.join(', ')}`;
    const method = document.createElement('span');
    method.textContent = finding.extraction === 'ocr'
      ? `OCR${finding.ocrConfidence !== null ? ` · ${finding.ocrConfidence}%` : ''}`
      : 'Текст документа';
    meta.append(location, trigger, method);

    article.append(head, quote, meta);
    ui.findings.append(article);
  });
}

function buildLeadMessage() {
  if (!analysis) return '';
  const categoryLine = analysis.categorySummary.length
    ? analysis.categorySummary.map((item) => `${item.name}: ${item.count}`).join('; ')
    : 'автоматически не определены';
  return [
    'Заявка после локального анализа документа',
    `Файл: ${analysis.file.name}`,
    `Формат: ${analysis.format}`,
    `Размер: ${formatBytes(analysis.file.size)}`,
    `Обработано разделов/страниц: ${analysis.pages.length}`,
    `Найдено фрагментов: ${analysis.findings.length}`,
    `Категории: ${categoryLine}`,
    'Сам файл не передавался на сайт. Пользователь просит инженерную проверку результата.',
  ].join('\n');
}

function renderResult() {
  const findingCount = analysis.findings.length;
  const evidenceCount = analysis.findings.filter((finding) => ['B', 'C'].includes(finding.confidence)).length;
  ui.countFindings.textContent = String(findingCount);
  ui.countPages.textContent = String(analysis.pages.length);
  ui.countEvidence.textContent = String(evidenceCount);

  if (findingCount) {
    ui.resultTitle.textContent = `Обнаружено ${findingCount} фрагментов для проверки`;
    ui.resultLead.textContent = 'Это реальные цитаты из выбранного документа. Категории определены автоматически; перед инженерным решением результат нужно проверить специалисту.';
  } else {
    ui.resultTitle.textContent = 'Явных признаков замечаний не обнаружено';
    ui.resultLead.textContent = 'Это не означает, что замечаний или рисков нет. Автоматический анализ мог не распознать формулировку — для ответственного решения нужна инженерная проверка.';
  }

  if (analysis.truncated) {
    ui.resultLead.textContent += ` Обработаны первые ${MAX_PDF_PAGES} страниц из ${analysis.totalUnits}.`;
  }
  renderCategoryBars(analysis.categorySummary, Math.max(1, findingCount));
  renderFilters(analysis.categorySummary);
  renderFindings();
  ui.leadMessage.value = buildLeadMessage();
  ui.process.hidden = true;
  ui.result.hidden = false;
  ui.result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function runAnalysis() {
  if (!selectedFile || running) return;
  running = true;
  cancelled = false;
  ui.cancel.disabled = false;
  showProcess();
  setProgress(2, 'Проверка файла', 'Проверяем формат, размер и сигнатуру файла.');

  try {
    let extracted;
    if (selectedFile.kind.id === 'pdf') extracted = await extractPdf(selectedFile.file);
    else if (selectedFile.kind.id === 'docx') extracted = await extractDocx(selectedFile.file);
    else if (selectedFile.kind.id === 'xlsx') extracted = await extractXlsx(selectedFile.file);
    else extracted = await extractImage(selectedFile.file);

    if (cancelled) throw new Error('Анализ отменён пользователем.');
    setProgress(82, 'Поиск замечаний', 'Сопоставляем реальные фрагменты документа с инженерными категориями.');
    const findings = buildFindings(extracted.pages);
    setProgress(96, 'Формирование отчёта', 'Готовим доказательные цитаты, категории и контекст заявки.');

    analysis = {
      createdAt: new Date().toISOString(),
      engineVersion: 'DNEPR Document Review 1.0',
      file: { name: selectedFile.file.name, size: selectedFile.file.size },
      format: extracted.format,
      pages: extracted.pages,
      totalUnits: extracted.totalUnits,
      truncated: extracted.truncated,
      findings,
      categorySummary: summarizeCategories(findings),
      disclaimer: 'Автоматический предварительный анализ. Не является инженерным или юридическим заключением.',
    };

    setProgress(100, 'Анализ завершён', 'Файл не покидал это устройство.');
    renderResult();
  } catch (error) {
    ui.process.hidden = true;
    ui.fileCard.hidden = false;
    setError(error?.message || 'Не удалось обработать файл. Попробуйте другой документ.');
  } finally {
    running = false;
    ui.cancel.disabled = true;
  }
}

function terminateOcr() {
  cancelled = true;
  if (ocrWorker) {
    ocrWorker.terminate().catch(() => {});
    ocrWorker = null;
  }
  setProgress(0, 'Остановка', 'Завершаем локальную обработку.');
}

function downloadBlob(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportBaseName() {
  const value = analysis.file.name.replace(/\.[^.]+$/, '').replace(/[^а-яёa-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
  return `dnepr-analiz-${value || 'dokument'}`;
}

function exportJson() {
  if (!analysis) return;
  downloadBlob(`${reportBaseName()}.json`, JSON.stringify(analysis, null, 2), 'application/json;charset=utf-8');
}

function exportCsv() {
  if (!analysis) return;
  const rows = [['ID', 'Категория', 'Локация', 'Уровень', 'Признаки', 'Цитата']];
  analysis.findings.forEach((finding) => rows.push([
    finding.id, finding.categoryName, finding.location, finding.confidence, finding.trigger.join('; '), finding.excerpt,
  ]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadBlob(`${reportBaseName()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
}

function exportHtml() {
  if (!analysis) return;
  const categoryRows = analysis.categorySummary.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${item.count}</strong></li>`).join('');
  const findingRows = analysis.findings.map((finding) => `
    <article>
      <header><b>${escapeHtml(finding.id)} · ${escapeHtml(finding.categoryName)}</b><span>Уровень ${escapeHtml(finding.confidence)}</span></header>
      <blockquote>${escapeHtml(finding.excerpt)}</blockquote>
      <small>${escapeHtml(finding.location)} · ${escapeHtml(finding.trigger.join(', '))}</small>
    </article>`).join('');
  const report = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Анализ ${escapeHtml(analysis.file.name)}</title><style>
  body{font:15px/1.55 Arial,sans-serif;color:#0d1720;max-width:980px;margin:0 auto;padding:44px}h1{font-size:34px;margin:0 0 8px}p{color:#56616b}.meta{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.meta b{background:#f3f1eb;padding:12px 16px}ul{padding:0;list-style:none;max-width:620px}li{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}article{break-inside:avoid;border:1px solid #d8d5ce;padding:18px;margin:14px 0}header{display:flex;justify-content:space-between;gap:16px}blockquote{margin:14px 0;padding-left:16px;border-left:3px solid #ffd229}small{color:#69737b}@media print{body{padding:0}button{display:none}}</style></head><body>
  <h1>Предварительный анализ документа</h1><p>${escapeHtml(analysis.file.name)} · ${escapeHtml(analysis.format)} · ${new Date(analysis.createdAt).toLocaleString('ru-RU')}</p>
  <div class="meta"><b>${analysis.findings.length} фрагментов</b><b>${analysis.pages.length} разделов/страниц</b></div>
  <h2>Категории</h2><ul>${categoryRows || '<li>Признаки не обнаружены</li>'}</ul>
  <h2>Фрагменты для проверки</h2>${findingRows || '<p>Явных признаков замечаний не обнаружено. Это не является подтверждением отсутствия замечаний.</p>'}
  <hr><p><b>Важно:</b> ${escapeHtml(analysis.disclaimer)} Файл обрабатывался локально в браузере и не передавался на сервер.</p>
  </body></html>`;
  downloadBlob(`${reportBaseName()}.html`, report, 'text/html;charset=utf-8');
}

ui.choose.addEventListener('click', () => ui.input.click());
ui.dropzone.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  ui.input.click();
});
ui.dropzone.addEventListener('keydown', (event) => {
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    ui.input.click();
  }
});
['dragenter', 'dragover'].forEach((type) => ui.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  ui.dropzone.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((type) => ui.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  ui.dropzone.classList.remove('is-dragging');
}));
ui.dropzone.addEventListener('drop', (event) => acceptFile(event.dataTransfer.files[0]));
ui.input.addEventListener('change', () => acceptFile(ui.input.files[0]));
ui.start.addEventListener('click', runAnalysis);
ui.cancel.addEventListener('click', terminateOcr);
ui.reset.forEach((button) => button.addEventListener('click', resetAnalyzer));
ui.exportJson.addEventListener('click', exportJson);
ui.exportCsv.addEventListener('click', exportCsv);
ui.exportHtml.addEventListener('click', exportHtml);
ui.leadForm?.addEventListener('submit', () => {
  ui.leadMessage.value = buildLeadMessage();
}, true);

window.addEventListener('pagehide', () => {
  if (ocrWorker) ocrWorker.terminate().catch(() => {});
});
