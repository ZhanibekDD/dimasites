const STORAGE_KEY = 'dnepr-stroypoisk-v1';

const types = {
  company: {
    label: 'Компания',
    short: 'ИНН / ОГРН / наименование',
    intro: 'Проверим юридическое лицо, официальный статус и строительный след по открытым государственным источникам.',
    sources: ['fns-profile', 'fns-extract', 'egrz', 'eis'],
  },
  egrz: {
    label: 'Заключение ЕГРЗ',
    short: 'номер заключения',
    intro: 'Откроем официальный реестр экспертиз и зафиксируем результат без подмены первоисточника.',
    sources: ['egrz', 'fns-profile'],
  },
  procurement: {
    label: 'Закупка',
    short: 'номер извещения или закупки',
    intro: 'Проверим карточку закупки в ЕИС и связанные сведения о заказчике или участниках.',
    sources: ['eis', 'fns-profile', 'egrz'],
  },
  cadastral: {
    label: 'Участок',
    short: 'кадастровый номер',
    intro: 'Проверим участок на официальной карте и подготовим следующий инженерный шаг.',
    sources: ['nspd', 'egrz'],
  },
  address: {
    label: 'Объект или адрес',
    short: 'адрес / наименование объекта',
    intro: 'Соберём маршрут проверки объекта по экспертизам, закупкам и пространственным данным.',
    sources: ['egrz', 'eis', 'nspd'],
  },
  free: {
    label: 'Свободный запрос',
    short: 'компания, объект или реквизит',
    intro: 'Запрос неоднозначен. Выберите тип вручную, чтобы построить точный маршрут проверки.',
    sources: ['fns-profile', 'egrz', 'eis', 'nspd'],
  },
};

const sources = {
  'fns-profile': {
    name: 'ФНС · Прозрачный бизнес',
    host: 'pb.nalog.ru',
    url: 'https://pb.nalog.ru/',
    purpose: 'Статус компании, ОКВЭД, адрес, руководитель и открытые показатели.',
    instruction: 'Вставьте ИНН, ОГРН или название в общий поиск ФНС.',
  },
  'fns-extract': {
    name: 'ФНС · Выписка ЕГРЮЛ / ЕГРИП',
    host: 'egrul.nalog.ru',
    url: 'https://egrul.nalog.ru/',
    purpose: 'Официальная выписка в PDF с электронной подписью ФНС.',
    instruction: 'Вставьте реквизит и сформируйте актуальную выписку.',
  },
  egrz: {
    name: 'ГИС ЕГРЗ',
    host: 'egrz.ru',
    url: 'https://egrz.ru/',
    purpose: 'Заключения экспертизы, объект, исполнители и результат экспертизы.',
    instruction: 'Вставьте номер, адрес, компанию или название объекта в поиск по реестру.',
  },
  eis: {
    name: 'ЕИС в сфере закупок',
    host: 'zakupki.gov.ru',
    url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html',
    purpose: 'Извещения, закупки, заказчики, документы и история процедур.',
    instruction: 'Вставьте номер или текст запроса в строку поиска ЕИС.',
  },
  nspd: {
    name: 'НСПД · Национальная система пространственных данных',
    host: 'nspd.gov.ru',
    url: 'https://nspd.gov.ru/',
    purpose: 'Официальная карта, кадастровый номер и пространственный контекст участка.',
    instruction: 'Откройте карту и вставьте кадастровый номер или адрес.',
  },
};

const stageActions = {
  company: ['Получить строительный профиль', 'Квалификация компании и партнёрство'],
  parcel: ['Проверить площадку', 'Изыскания и проектирование'],
  concept: ['Собрать дорожную карту', 'Исходные данные и проектирование'],
  design: ['Проверить готовность ПД', 'Корректировка и сопровождение'],
  expertise: ['Подготовиться к строительству', 'Генподряд и подготовительные работы'],
  permit: ['Проверить готовность площадки', 'Генподряд и СМР'],
  refusal: ['Получить план устранения', 'Корректировка проекта и Project Rescue'],
  construction: ['Рассчитать мобилизацию', 'СМР, технадзор и комплектация'],
  operation: ['Проверить эксплуатационные требования', 'ПНР, ремонт и обслуживание'],
};

const ui = {
  form: document.querySelector('[data-search-form]'),
  input: document.querySelector('[data-search-input]'),
  type: document.querySelector('[data-search-type]'),
  error: document.querySelector('[data-search-error]'),
  result: document.querySelector('[data-search-result]'),
  resultKind: document.querySelector('[data-result-kind]'),
  resultQuery: document.querySelector('[data-result-query]'),
  resultIntro: document.querySelector('[data-result-intro]'),
  validation: document.querySelector('[data-validation]'),
  routes: document.querySelector('[data-source-routes]'),
  sourceCount: document.querySelector('[data-source-count]'),
  stage: document.querySelector('[data-project-stage]'),
  actionTitle: document.querySelector('[data-action-title]'),
  actionService: document.querySelector('[data-action-service]'),
  leadMessage: document.querySelector('[data-search-lead-message]'),
  history: document.querySelector('[data-search-history]'),
  historyEmpty: document.querySelector('[data-history-empty]'),
  exportHtml: document.querySelector('[data-export-passport-html]'),
  exportJson: document.querySelector('[data-export-passport-json]'),
  reset: document.querySelectorAll('[data-search-reset]'),
};

let active = null;

function cleanQuery(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function digits(value) {
  return value.replace(/\D/g, '');
}

function checksum(values, factors) {
  return factors.reduce((sum, factor, index) => sum + Number(values[index]) * factor, 0) % 11 % 10;
}

function validateInn(value) {
  if (!/^\d{10}$|^\d{12}$/.test(value)) return false;
  if (/^(\d)\1+$/.test(value)) return false;
  if (value.length === 10) {
    return checksum(value, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[9]);
  }
  return checksum(value, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[10])
    && checksum(value, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[11]);
}

function validateOgrn(value) {
  if (/^\d{13}$/.test(value)) return Number(BigInt(value.slice(0, 12)) % 11n % 10n) === Number(value[12]);
  if (/^\d{15}$/.test(value)) return Number(BigInt(value.slice(0, 14)) % 13n % 10n) === Number(value[14]);
  return false;
}

function detect(value) {
  const compact = value.replace(/\s/g, '');
  const numeric = digits(compact);
  if (/^\d{2}:\d{2}:\d{6,7}:\d+$/.test(compact)) {
    return { type: 'cadastral', validation: 'Формат кадастрового номера распознан', valid: true };
  }
  if (/^\d{2}-\d-\d-\d-\d{6}-\d{4}$/.test(compact)) {
    return { type: 'egrz', validation: 'Формат номера заключения ЕГРЗ распознан', valid: true };
  }
  if ([10, 12].includes(numeric.length) && numeric === compact) {
    const valid = validateInn(numeric);
    return { type: 'company', validation: valid ? 'Контрольная сумма ИНН подтверждена' : 'ИНН похож по длине, но контрольная сумма не совпала', valid };
  }
  if ([13, 15].includes(numeric.length) && numeric === compact) {
    const valid = validateOgrn(numeric);
    return { type: 'company', validation: valid ? 'Контрольная цифра ОГРН подтверждена' : 'ОГРН похож по длине, но контрольная цифра не совпала', valid };
  }
  if (/^\d{18,23}$/.test(numeric) && numeric === compact) {
    return { type: 'procurement', validation: 'Цифровой номер направлен в официальный поиск ЕИС', valid: null };
  }
  if (/\b(ул\.?|улица|проспект|пр-т|шоссе|проезд|д\.?|дом|корпус|строение|район|область|месторождение)\b/i.test(value)) {
    return { type: 'address', validation: 'Распознан адрес или наименование объекта', valid: null };
  }
  if (/[а-яёa-z]{3}/i.test(value)) {
    return { type: value.length <= 180 ? 'company' : 'free', validation: 'Текстовый запрос: тип можно уточнить вручную', valid: null };
  }
  return { type: 'free', validation: 'Тип запроса не определён', valid: null };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (symbol) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[symbol]));
}

function getSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 20) : [];
  } catch (_) {
    return [];
  }
}

function setSaved(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 20))); } catch (_) { /* private mode */ }
}

function persist() {
  if (!active) return;
  active.updatedAt = new Date().toISOString();
  const items = getSaved().filter((item) => item.id !== active.id);
  setSaved([active, ...items]);
  renderHistory();
}

function statusLabel(status) {
  return ({ unchecked: 'Не проверено', found: 'Запись найдена', missing: 'Не найдено в источнике', unavailable: 'Источник недоступен' })[status] || 'Не проверено';
}

async function copyQuery() {
  if (!active) return;
  try {
    await navigator.clipboard.writeText(active.query);
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = active.query;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function renderRoutes() {
  ui.routes.replaceChildren();
  ui.sourceCount.textContent = String(active.sources.length);
  active.sources.forEach((record, index) => {
    const source = sources[record.id];
    const article = document.createElement('article');
    article.className = 'source-route';
    article.dataset.status = record.status;
    article.innerHTML = `
      <div class="route-line"><span>${String(index + 1).padStart(2, '0')}</span><i></i><b>${escapeHtml(source.host)}</b></div>
      <div class="route-head"><div><small>Официальный источник</small><h3>${escapeHtml(source.name)}</h3></div><span class="evidence-grade">A*</span></div>
      <p>${escapeHtml(source.purpose)}</p>
      <div class="route-instruction"><b>Как проверить</b><span>${escapeHtml(source.instruction)}</span></div>
      <div class="route-actions">
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" data-open-source>Скопировать запрос и открыть <span>↗</span></a>
        <label><span>Результат проверки</span><select data-source-status>
          <option value="unchecked">Не проверено</option>
          <option value="found">Запись найдена</option>
          <option value="missing">Не найдено в источнике</option>
          <option value="unavailable">Источник недоступен</option>
        </select></label>
      </div>
      <label class="route-note"><span>Идентификатор, ссылка или заметка</span><input data-source-note maxlength="300" placeholder="Например: номер записи или что нужно уточнить"></label>
      <div class="route-proof"><span data-proof-status>${escapeHtml(statusLabel(record.status))}</span><time>${new Date(record.checkedAt || active.createdAt).toLocaleString('ru-RU')}</time></div>`;
    const select = article.querySelector('[data-source-status]');
    const note = article.querySelector('[data-source-note]');
    select.value = record.status;
    note.value = record.note || '';
    article.querySelector('[data-open-source]').addEventListener('click', copyQuery);
    select.addEventListener('change', () => {
      record.status = select.value;
      record.checkedAt = new Date().toISOString();
      article.dataset.status = record.status;
      article.querySelector('[data-proof-status]').textContent = statusLabel(record.status);
      article.querySelector('time').textContent = new Date(record.checkedAt).toLocaleString('ru-RU');
      persist();
      updateLead();
    });
    note.addEventListener('change', () => {
      record.note = note.value.trim();
      persist();
      updateLead();
    });
    ui.routes.append(article);
  });
}

function updateAction() {
  const [title, service] = stageActions[ui.stage.value] || stageActions.company;
  ui.actionTitle.textContent = title;
  ui.actionService.textContent = service;
  if (active) {
    active.stage = ui.stage.value;
    active.nextAction = title;
    persist();
    updateLead();
  }
}

function updateLead() {
  if (!active || !ui.leadMessage) return;
  const checked = active.sources.filter((item) => item.status !== 'unchecked');
  const lines = checked.map((item) => `${sources[item.id].name}: ${statusLabel(item.status)}${item.note ? ` — ${item.note}` : ''}`);
  ui.leadMessage.value = [
    'Заявка после Стройпоиска',
    `Запрос: ${active.query}`,
    `Тип: ${types[active.type].label}`,
    `Стадия: ${ui.stage.options[ui.stage.selectedIndex].text}`,
    `Следующий шаг: ${active.nextAction || stageActions.company[0]}`,
    lines.length ? `Проверки:\n${lines.join('\n')}` : 'Официальные источники пока не отмечены пользователем.',
    'Сведения в заявке внесены пользователем; ДНЕПР не утверждает их без проверки первоисточника.',
  ].join('\n');
}

function renderResult() {
  const type = types[active.type];
  ui.resultKind.textContent = type.label;
  ui.resultQuery.textContent = active.query;
  ui.resultIntro.textContent = type.intro;
  ui.validation.textContent = active.validation;
  ui.validation.dataset.valid = active.valid === true ? 'yes' : active.valid === false ? 'no' : 'unknown';
  ui.stage.value = active.stage || 'company';
  renderRoutes();
  updateAction();
  updateLead();
  ui.result.hidden = false;
  ui.result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function runSearch(value, forcedType = 'auto') {
  const query = cleanQuery(value);
  if (query.length < 3) {
    ui.error.textContent = 'Введите не менее трёх символов.';
    ui.error.hidden = false;
    return;
  }
  ui.error.hidden = true;
  const detected = detect(query);
  const selectedType = forcedType === 'auto' ? detected.type : forcedType;
  const validation = forcedType === 'auto' ? detected.validation : `Тип выбран вручную: ${types[selectedType].label}`;
  const valid = forcedType === 'auto' ? detected.valid : null;
  active = {
    id: `SP-${Date.now().toString(36).toUpperCase()}`,
    query,
    type: selectedType,
    validation,
    valid,
    stage: 'company',
    nextAction: stageActions.company[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: types[selectedType].sources.map((id) => ({ id, status: 'unchecked', note: '', checkedAt: null })),
  };
  persist();
  renderResult();
}

function restore(id) {
  const record = getSaved().find((item) => item.id === id);
  if (!record || !types[record.type]) return;
  active = record;
  ui.input.value = record.query;
  ui.type.value = record.type;
  renderResult();
}

function removeSaved(id) {
  setSaved(getSaved().filter((item) => item.id !== id));
  if (active?.id === id) {
    active = null;
    ui.result.hidden = true;
  }
  renderHistory();
}

function renderHistory() {
  const records = getSaved();
  ui.history.replaceChildren();
  ui.historyEmpty.hidden = records.length > 0;
  records.forEach((record) => {
    const row = document.createElement('article');
    row.className = 'history-row';
    const checked = record.sources.filter((source) => source.status !== 'unchecked').length;
    row.innerHTML = `<button type="button" data-restore><span>${escapeHtml(types[record.type]?.label || 'Запрос')} · ${escapeHtml(record.id)}</span><strong>${escapeHtml(record.query)}</strong><small>${new Date(record.updatedAt).toLocaleString('ru-RU')} · проверено ${checked}/${record.sources.length}</small></button><button type="button" data-remove aria-label="Удалить запись">×</button>`;
    row.querySelector('[data-restore]').addEventListener('click', () => restore(record.id));
    row.querySelector('[data-remove]').addEventListener('click', () => removeSaved(record.id));
    ui.history.append(row);
  });
}

function passportData() {
  return {
    schema: 'dnepr-stroypoisk-passport/1.0',
    id: active.id,
    query: active.query,
    queryType: active.type,
    queryTypeLabel: types[active.type].label,
    validation: active.validation,
    createdAt: active.createdAt,
    updatedAt: active.updatedAt,
    projectStage: active.stage,
    nextAction: active.nextAction,
    evidence: active.sources.map((record) => ({
      source: sources[record.id].name,
      sourceUrl: sources[record.id].url,
      retrievedAt: record.checkedAt,
      status: record.status,
      statusLabel: statusLabel(record.status),
      note: record.note || '',
      confidence: record.status === 'found' ? 'A — только после сверки записи' : null,
    })),
    disclaimer: 'Статусы заполнены пользователем. «Не найдено в источнике» не означает, что документа или факта не существует.',
  };
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  if (!active) return;
  download(`${active.id.toLowerCase()}.json`, JSON.stringify(passportData(), null, 2), 'application/json;charset=utf-8');
}

function exportHtml() {
  if (!active) return;
  const data = passportData();
  const rows = data.evidence.map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.statusLabel)}</td><td>${escapeHtml(item.retrievedAt ? new Date(item.retrievedAt).toLocaleString('ru-RU') : '—')}</td><td>${escapeHtml(item.note || '—')}</td><td><a href="${escapeHtml(item.sourceUrl)}">Открыть источник</a></td></tr>`).join('');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>СтройПаспорт ${escapeHtml(data.id)}</title><style>body{font:15px/1.55 Arial,sans-serif;max-width:1100px;margin:auto;padding:44px;color:#111d27}h1{font-size:38px;margin-bottom:8px}.meta{color:#64717a}table{width:100%;border-collapse:collapse;margin:30px 0}th,td{text-align:left;padding:12px;border:1px solid #d7d9d7;vertical-align:top}th{background:#111d27;color:#fff}.warning{border-left:5px solid #ffd229;padding:16px;background:#f5f2e8}@media(max-width:700px){body{padding:20px}table{font-size:12px;display:block;overflow:auto}}</style></head><body><h1>СтройПаспорт проверки</h1><p class="meta">${escapeHtml(data.id)} · ${escapeHtml(new Date(data.updatedAt).toLocaleString('ru-RU'))}</p><h2>${escapeHtml(data.query)}</h2><p>${escapeHtml(data.queryTypeLabel)} · ${escapeHtml(data.validation)}</p><table><thead><tr><th>Источник</th><th>Статус</th><th>Дата проверки</th><th>Заметка</th><th>Первоисточник</th></tr></thead><tbody>${rows}</tbody></table><p><b>Следующий шаг:</b> ${escapeHtml(data.nextAction)}</p><p class="warning">${escapeHtml(data.disclaimer)}</p></body></html>`;
  download(`${active.id.toLowerCase()}.html`, html, 'text/html;charset=utf-8');
}

ui.form?.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(ui.input.value, ui.type.value);
});
ui.stage?.addEventListener('change', updateAction);
ui.exportJson?.addEventListener('click', exportJson);
ui.exportHtml?.addEventListener('click', exportHtml);
ui.reset.forEach((button) => button.addEventListener('click', () => {
  active = null;
  ui.result.hidden = true;
  ui.input.focus();
}));
document.querySelector('[data-search-lead-form]')?.addEventListener('submit', updateLead, true);

renderHistory();
