const STORAGE_KEY = 'dnepr-stroypoisk-v1';

const types = {
  company: {
    label: 'Компания',
    short: 'ИНН / ОГРН / наименование',
    intro: 'Проверим юридическое лицо, официальный статус и строительный след по открытым государственным источникам.',
    sources: ['fns-profile', 'egrz', 'eis'],
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
    purpose: 'Статус компании, регистрационные данные, регион и основной ОКВЭД.',
    instruction: 'Стройпоиск запрашивает ФНС автоматически и показывает карточку прямо на этой странице.',
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
    instruction: 'Стройпоиск сам отправляет запрос в публичный реестр и показывает найденные заключения и выгрузки.',
  },
  eis: {
    name: 'ЕИС в сфере закупок',
    host: 'zakupki.gov.ru',
    url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html',
    purpose: 'Извещения, закупки, заказчики, документы и история процедур.',
    instruction: 'Стройпоиск сам запрашивает публичный поиск ЕИС и показывает карточки и страницы документов.',
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
  companyProfile: document.querySelector('[data-company-profile]'),
  companyProfileState: document.querySelector('[data-company-profile-state]'),
  companyProfileBody: document.querySelector('[data-company-profile-body]'),
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
let companyRequestController = null;
const sourceRequestControllers = new Map();

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

function setCompanyState(state, label) {
  if (!ui.companyProfileState) return;
  ui.companyProfileState.dataset.state = state;
  ui.companyProfileState.innerHTML = `<i></i><span>${escapeHtml(label)}</span>`;
}

function markFnsSource(status, note, checkedAt = new Date().toISOString()) {
  if (!active || active.type !== 'company') return;
  const record = active.sources.find((item) => item.id === 'fns-profile');
  if (!record) return;
  record.status = status;
  record.note = String(note || '').slice(0, 300);
  record.checkedAt = checkedAt;
  persist();
  renderRoutes();
  updateLead();
}

function markSource(sourceId, status, note, checkedAt = new Date().toISOString(), response = null) {
  if (!active) return;
  const record = active.sources.find((item) => item.id === sourceId);
  if (!record) return;
  record.status = status;
  record.note = String(note || '').slice(0, 500);
  record.checkedAt = checkedAt;
  if (response) record.response = response;
  persist();
  renderRoutes();
  updateLead();
}

function renderCompanyLoading() {
  if (!ui.companyProfile || !ui.companyProfileBody) return;
  ui.companyProfile.hidden = false;
  setCompanyState('loading', 'Запрашиваем ФНС');
  ui.companyProfileBody.innerHTML = `
    <div class="company-loading" role="status">
      <span class="company-loading-orbit" aria-hidden="true"><i></i><b></b></span>
      <div><strong>ФНС готовит официальный ответ</strong><p>Обычно это занимает несколько секунд. Запрос выполняется в защищённой серверной сессии.</p></div>
    </div>`;
}

function renderCompanyMessage(state, title, message, retry = false) {
  if (!ui.companyProfile || !ui.companyProfileBody) return;
  ui.companyProfile.hidden = false;
  setCompanyState(state, state === 'missing' ? 'Запись не найдена' : 'Нужна повторная проверка');
  ui.companyProfileBody.innerHTML = `
    <div class="company-message" data-state="${escapeHtml(state)}">
      <div><span>${state === 'missing' ? '0' : '!'}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>
      <div class="company-message-actions">
        ${retry ? '<button type="button" data-company-retry>Повторить запрос <span>↻</span></button>' : ''}
        <a href="https://pb.nalog.ru/" target="_blank" rel="noopener noreferrer">Официальный сервис ФНС <span>↗</span></a>
      </div>
    </div>`;
  ui.companyProfileBody.querySelector('[data-company-retry]')?.addEventListener('click', () => fetchCompanyProfile(true));
}

const officialHosts = new Set([
  'pb.nalog.ru',
  'egrul.nalog.ru',
  'rmsp.nalog.ru',
  'bo.nalog.gov.ru',
  'service.nalog.ru',
  'egrz.ru',
  'www.egrz.ru',
  'zakupki.gov.ru',
  'www.zakupki.gov.ru',
]);

function safeOfficialHref(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && officialHosts.has(url.hostname.toLowerCase()) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function describeOfficialField(key, value) {
  const normalized = String(value ?? '');
  if (['pr_liq', 'invalid', 'predo'].includes(key)) {
    if (normalized === '0') return '0 · нет';
    if (normalized === '1') return '1 · да';
  }
  return normalized || '—';
}

function renderCompanyDocuments(company) {
  const documents = Array.isArray(company.documents) ? company.documents : [];
  const links = documents.map((document) => {
    const href = safeOfficialHref(document.url);
    if (!href) return '';
    const kind = ({
      'direct-pdf': 'PDF из ответа ФНС',
      'official-card': 'Карточка ФНС',
      'authorized-service': 'Сервис с ЕСИА',
      'official-service': 'Официальный сервис',
    })[document.kind] || 'Документ ФНС';
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
      <span><small>${escapeHtml(kind)}</small><strong>${escapeHtml(document.label || 'Официальный документ')}</strong><em>${escapeHtml(document.note || '')}</em></span><b>↗</b>
    </a>`;
  }).filter(Boolean).join('');
  if (!links) return '';
  return `<section class="company-documents" aria-label="Документы и сервисы ФНС">
    <div class="company-documents-head"><span>ДОКУМЕНТЫ</span><strong>${documents.length}</strong><p>Показаны только ссылки, которые вернул официальный ответ ФНС, и официальный сервис выписки.</p></div>
    <div class="company-document-links">${links}</div>
  </section>`;
}

function renderCompanyRecord(company, index, count, payload) {
  const fields = Array.isArray(company.officialFields) ? company.officialFields : [];
  const fieldRows = fields.map((field) => `<div><dt>${escapeHtml(field.label || field.key || 'Поле ФНС')}</dt><dd>${escapeHtml(describeOfficialField(field.key, field.value))}</dd><small>${escapeHtml(field.key || '')}</small></div>`).join('');
  const retrievedAt = payload.source?.retrievedAt || new Date().toISOString();
  return `<article class="company-card company-card--record">
    <header>
      <div><span>РЕЗУЛЬТАТ ${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')} · ${company.entityType === 'entrepreneur' ? 'ИП' : 'ЮРИДИЧЕСКОЕ ЛИЦО'}</span><h3>${escapeHtml(company.shortName || company.fullName || active.query)}</h3></div>
      <strong>${escapeHtml(company.status || 'Статус не указан')}</strong>
    </header>
    ${company.fullName && company.fullName !== company.shortName ? `<p class="company-full-name">${escapeHtml(company.fullName)}</p>` : ''}
    <dl class="company-facts">
      <div><dt>ИНН</dt><dd>${escapeHtml(company.inn || '—')}</dd></div>
      <div><dt>${company.entityType === 'entrepreneur' ? 'ОГРНИП' : 'ОГРН'}</dt><dd>${escapeHtml(company.ogrn || '—')}</dd></div>
      <div><dt>Дата регистрации</dt><dd>${escapeHtml(company.registeredAt || '—')}</dd></div>
      <div><dt>Дата присвоения ОГРН</dt><dd>${escapeHtml(company.ogrnAssignedAt || '—')}</dd></div>
      <div><dt>Регион</dt><dd>${escapeHtml(company.region || '—')}</dd></div>
      <div><dt>Статус · код</dt><dd>${escapeHtml([company.status, company.statusCode].filter(Boolean).join(' · ') || '—')}</dd></div>
      <div class="company-fact-wide"><dt>Основной ОКВЭД</dt><dd>${escapeHtml([company.okved, company.okvedName].filter(Boolean).join(' · ') || '—')}</dd></div>
      <div><dt>Отчётный период</dt><dd>${escapeHtml([company.reportingYear, company.reportingPeriod].filter(Boolean).join(' · ') || '—')}</dd></div>
    </dl>
    <details class="company-response-fields" ${index === 0 ? 'open' : ''}>
      <summary><span>Все поля ответа ФНС</span><b>${fields.length}</b><em>развернуть ↘</em></summary>
      <dl class="company-detail-grid">${fieldRows || '<div><dt>Дополнительные поля</dt><dd>ФНС не вернула дополнительных значений</dd></div>'}</dl>
    </details>
    ${renderCompanyDocuments(company)}
    <footer>
      <div><span>Источник и время получения</span><strong>${escapeHtml(payload.source?.name || 'ФНС России')}</strong><time>${escapeHtml(new Date(retrievedAt).toLocaleString('ru-RU'))}</time></div>
      <a class="company-source-link" href="${escapeHtml(safeOfficialHref(payload.source?.url) || 'https://pb.nalog.ru/')}" target="_blank" rel="noopener noreferrer">Открыть первоисточник <span>↗</span></a>
    </footer>
  </article>`;
}

function renderFnsSections(payload) {
  const sections = Array.isArray(payload.responseSections) ? payload.responseSections : [];
  if (!sections.length) return '';
  const cards = sections.map((section) => {
    const records = Array.isArray(section.records) ? section.records : [];
    const recordHtml = records.map((record, recordIndex) => {
      const fields = Object.entries(record || {}).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(describeOfficialField(key, value))}</dd></div>`).join('');
      return fields ? `<details><summary>Запись ${recordIndex + 1}</summary><dl>${fields}</dl></details>` : '';
    }).join('');
    return `<article class="fns-response-section" data-has-records="${records.length ? 'true' : 'false'}"><div><small>${escapeHtml(section.id || '')}</small><strong>${escapeHtml(section.label || 'Раздел ответа')}</strong><span>${escapeHtml(section.rowCount ?? 0)}</span></div><p>Получено в ответе: ${escapeHtml(section.returned ?? records.length)}${section.hasMore ? ' · есть следующая страница' : ''}</p>${recordHtml}</article>`;
  }).join('');
  return `<section class="fns-response-sections" aria-label="Все разделы ответа ФНС"><header><span>РАЗДЕЛЫ ОТВЕТА ФНС</span><strong>${sections.length}</strong><p>Показаны счётчики и безопасные поля всех разделов ответа. Служебные токены сессии скрыты.</p></header><div>${cards}</div></section>`;
}

function renderCompanyData(payload) {
  if (!ui.companyProfile || !ui.companyProfileBody || !active) return;
  const companies = Array.isArray(payload.companies) ? payload.companies : [];
  if (!companies.length) {
    renderCompanyMessage('missing', 'Компания не найдена в ответе ФНС', 'Уточните ИНН, ОГРН или полное наименование. Это не доказывает, что организации не существует.');
    return;
  }
  const total = Number(payload.total || companies.length);
  const legalCount = Number(payload.counts?.legalEntities || 0);
  const entrepreneurCount = Number(payload.counts?.entrepreneurs || 0);
  const fallback = Boolean(payload.partial || payload.source?.fallback);
  const sourceName = payload.source?.name || 'ФНС России';
  ui.companyProfile.hidden = false;
  setCompanyState('found', `${fallback ? 'Резервный ответ ФНС' : (payload.source?.cached ? 'Ответ ФНС · кэш' : 'Ответ ФНС · получен')} · ${total}`);
  ui.companyProfileBody.innerHTML = `
    <div class="fns-response-summary">
      <div><span>${fallback ? 'РЕЗЕРВНЫЙ ОФИЦИАЛЬНЫЙ ОТВЕТ' : 'ПОЛНЫЙ ОТВЕТ ПОИСКА'}</span><strong>${total}</strong><p>${fallback ? 'Основной сервис не ответил. Показаны записи официального ЕГРЮЛ / ЕГРИП; расширенные разделы появятся после восстановления «Прозрачного бизнеса».' : `Найдено записей. На странице показаны все ${companies.length} записей, возвращённые текущим ответом ФНС.`}</p></div>
      <dl><div><dt>Юридические лица</dt><dd>${legalCount}</dd></div><div><dt>Индивидуальные предприниматели</dt><dd>${entrepreneurCount}</dd></div><div><dt>Источник</dt><dd>${escapeHtml(sourceName)}</dd></div></dl>
    </div>
    <div class="company-results">${companies.map((company, index) => renderCompanyRecord(company, index, companies.length, payload)).join('')}</div>
    ${renderFnsSections(payload)}
    <p class="company-disclaimer">${fallback ? '<strong>Резервный официальный источник.</strong> ' : ''}${escapeHtml(payload.disclaimer || 'Для юридически значимого решения сформируйте актуальную выписку ЕГРЮЛ или ЕГРИП.')}</p>`;
}

async function fetchCompanyProfile(force = false) {
  if (!active || active.type !== 'company' || !ui.companyProfile) return;
  const requestId = active.id;
  if (active.valid === false) {
    renderCompanyMessage('error', 'Автопроверка не запущена', 'Сначала исправьте контрольную цифру ИНН или ОГРН. Запрос с ошибкой не отправлен в ФНС.');
    return;
  }
  if (!force && active.companyProfile?.found) {
    renderCompanyData(active.companyProfile);
  } else {
    renderCompanyLoading();
  }
  if (companyRequestController) companyRequestController.abort();
  const controller = new AbortController();
  companyRequestController = controller;
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('/api/fns-company.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: active.query }),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => null);
    if (!active || active.id !== requestId || companyRequestController !== controller) return;
    if (!response.ok || !payload?.ok) {
      const message = payload?.message || 'Официальный источник временно не ответил.';
      const diagnostic = payload?.diagnosticId ? ` Код диагностики: ${payload.diagnosticId}.` : '';
      markFnsSource('unavailable', `Автопроверка: ${message}${diagnostic}`);
      renderCompanyMessage('error', payload?.code === 'captcha_required' ? 'ФНС запросила ручную проверку' : 'ФНС временно недоступна', `${message}${diagnostic}`, true);
      return;
    }
    active.companyProfile = payload;
    if (!payload.found || !payload.companies?.length) {
      markFnsSource('missing', 'Автоматический запрос ФНС: запись не найдена', payload.source?.retrievedAt);
      persist();
      renderCompanyMessage('missing', 'В ответе ФНС нет подходящей организации', 'Проверьте написание или используйте ИНН/ОГРН. «Не найдено» относится только к этому запросу и времени проверки.', true);
      return;
    }
    const company = payload.companies[0];
    markFnsSource('found', `${payload.source?.fallback ? 'Резерв ЕГРЮЛ / ЕГРИП' : 'ФНС'} вернул записей: ${payload.total || payload.companies.length}. Первая: ${company.shortName || company.fullName}; ИНН ${company.inn}; ОГРН ${company.ogrn}`, payload.source?.retrievedAt);
    persist();
    renderCompanyData(payload);
  } catch (error) {
    if (!active || active.id !== requestId || companyRequestController !== controller) return;
    const aborted = error?.name === 'AbortError';
    const message = aborted ? 'Время ожидания ответа истекло. Повторите запрос.' : 'Не удалось получить ответ ФНС. Повторите проверку.';
    markFnsSource('unavailable', `Автопроверка: ${message}`);
    renderCompanyMessage('error', 'ФНС временно не ответила', message, true);
  } finally {
    clearTimeout(timeout);
    if (companyRequestController === controller) companyRequestController = null;
  }
}

function sourceResponseHtml(record) {
  if (record.loading) {
    return '<div class="source-live-result" data-state="loading"><span class="source-spinner"></span><div><strong>Запрос отправлен</strong><p>Ждём ответ официального источника…</p></div></div>';
  }
  const payload = record.response;
  if (!payload) return '';
  if (payload.ok === false) {
    return `<div class="source-live-result" data-state="error"><b>!</b><div><strong>Источник не ответил</strong><p>${escapeHtml(payload.message || 'Временная ошибка официального источника.')}</p>${payload.diagnosticId ? `<small>Диагностика: ${escapeHtml(payload.diagnosticId)}</small>` : ''}</div></div>`;
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  const sharedFiles = Array.isArray(payload.files) ? payload.files : [];
  const cards = results.map((item) => {
    const href = safeOfficialHref(item.url);
    const documents = Array.isArray(item.documents) ? item.documents : [];
    const documentLinks = documents.map((document) => {
      const documentHref = safeOfficialHref(document.url);
      return documentHref ? `<a href="${escapeHtml(documentHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.label || 'Документы')} <span>↗</span></a>` : '';
    }).filter(Boolean).join('');
    const facts = [item.status, item.customer, item.publishedAt, item.price].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join('');
    return `<article class="source-record"><div><small>${escapeHtml(item.number || item.id || 'ОФИЦИАЛЬНАЯ ЗАПИСЬ')}</small><h4>${escapeHtml(item.title || 'Найдена запись')}</h4>${facts ? `<p class="source-record-facts">${facts}</p>` : ''}<p>${escapeHtml(item.summary || '')}</p></div><footer>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Открыть карточку <span>↗</span></a>` : ''}${documentLinks}</footer></article>`;
  }).join('');
  const fileLinks = sharedFiles.map((file) => {
    const href = safeOfficialHref(file.url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.label || 'Выгрузка реестра')} <span>↓</span></a>` : '';
  }).filter(Boolean).join('');
  const checkedAt = payload.source?.retrievedAt ? new Date(payload.source.retrievedAt).toLocaleString('ru-RU') : new Date().toLocaleString('ru-RU');
  return `<div class="source-live-result" data-state="${results.length ? 'found' : 'missing'}"><div class="source-result-head"><div><span>ОТВЕТ ОФИЦИАЛЬНОГО ИСТОЧНИКА</span><strong>${results.length}</strong></div><p>${results.length ? `Показаны все ${results.length} записей текущего ответа.` : 'В текущем ответе записей нет. Это не доказывает отсутствие документа.'}</p><time>${escapeHtml(checkedAt)}</time></div>${cards ? `<div class="source-records">${cards}</div>` : ''}${fileLinks ? `<div class="source-files"><span>ФАЙЛЫ И ВЫГРУЗКИ</span>${fileLinks}</div>` : ''}<small class="source-diagnostic">${payload.diagnosticId ? `Диагностика: ${escapeHtml(payload.diagnosticId)} · ` : ''}${escapeHtml(payload.disclaimer || '')}</small></div>`;
}

async function fetchRegistrySource(sourceId, force = false) {
  if (!active || !['egrz', 'eis'].includes(sourceId)) return;
  const record = active.sources.find((item) => item.id === sourceId);
  if (!record) return;
  if (!force && record.response?.ok) return;
  const requestId = active.id;
  sourceRequestControllers.get(sourceId)?.abort();
  const controller = new AbortController();
  sourceRequestControllers.set(sourceId, controller);
  record.loading = true;
  renderRoutes();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch('/api/source-search.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ source: sourceId, query: active.query }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!active || active.id !== requestId || sourceRequestControllers.get(sourceId) !== controller) return;
    record.loading = false;
    if (!response.ok || !payload?.ok) {
      const message = payload?.message || 'Официальный источник временно не ответил.';
      const diagnostic = payload?.diagnosticId ? ` Код: ${payload.diagnosticId}.` : '';
      markSource(sourceId, 'unavailable', `${message}${diagnostic}`, new Date().toISOString(), { ok: false, message, diagnosticId: payload?.diagnosticId || '' });
      return;
    }
    const count = Array.isArray(payload.results) ? payload.results.length : 0;
    markSource(sourceId, payload.found ? 'found' : 'missing', payload.found ? `Автопроверка: найдено записей ${count}.` : 'Автопроверка: в текущем ответе записей нет.', payload.source?.retrievedAt, payload);
  } catch (error) {
    if (!active || active.id !== requestId || sourceRequestControllers.get(sourceId) !== controller) return;
    record.loading = false;
    const message = error?.name === 'AbortError' ? 'Время ожидания ответа истекло.' : 'Не удалось выполнить серверный запрос.';
    markSource(sourceId, 'unavailable', message, new Date().toISOString(), { ok: false, message });
  } finally {
    clearTimeout(timeout);
    if (sourceRequestControllers.get(sourceId) === controller) sourceRequestControllers.delete(sourceId);
  }
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
    const isAutomaticFns = record.id === 'fns-profile' && active.type === 'company';
    const isAutomaticRegistry = ['egrz', 'eis'].includes(record.id);
    const article = document.createElement('article');
    article.className = 'source-route';
    article.dataset.status = record.status;
    article.innerHTML = `
      <div class="route-line"><span>${String(index + 1).padStart(2, '0')}</span><i></i><b>${escapeHtml(source.host)}</b></div>
      <div class="route-head"><div><small>Официальный источник</small><h3>${escapeHtml(source.name)}</h3></div><span class="evidence-grade">A*</span></div>
      <p>${escapeHtml(source.purpose)}</p>
      <div class="route-instruction"><b>Как проверить</b><span>${escapeHtml(source.instruction)}</span></div>
      <div class="route-actions">
        ${isAutomaticFns
          ? '<button type="button" class="route-auto-check" data-company-route-check>Повторить автопроверку <span>↻</span></button>'
          : isAutomaticRegistry
            ? `<button type="button" class="route-auto-check" data-registry-route-check="${escapeHtml(record.id)}">${record.loading ? 'Проверяем…' : 'Повторить автопроверку'} <span>↻</span></button>`
          : `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" data-open-source>Скопировать запрос и открыть <span>↗</span></a>`}
        <label><span>Результат проверки</span><select data-source-status>
          <option value="unchecked">Не проверено</option>
          <option value="found">Запись найдена</option>
          <option value="missing">Не найдено в источнике</option>
          <option value="unavailable">Источник недоступен</option>
        </select></label>
      </div>
      ${sourceResponseHtml(record)}
      <label class="route-note"><span>Идентификатор, ссылка или заметка</span><input data-source-note maxlength="300" placeholder="Например: номер записи или что нужно уточнить"></label>
      <div class="route-proof"><span data-proof-status>${escapeHtml(statusLabel(record.status))}</span><time>${new Date(record.checkedAt || active.createdAt).toLocaleString('ru-RU')}</time></div>`;
    const select = article.querySelector('[data-source-status]');
    const note = article.querySelector('[data-source-note]');
    select.value = record.status;
    note.value = record.note || '';
    article.querySelector('[data-open-source]')?.addEventListener('click', copyQuery);
    article.querySelector('[data-company-route-check]')?.addEventListener('click', () => fetchCompanyProfile(true));
    article.querySelector('[data-registry-route-check]')?.addEventListener('click', () => fetchRegistrySource(record.id, true));
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
  const company = active.companyProfile?.companies?.[0];
  const companyLines = company ? [
    `Компания по данным ФНС: ${company.shortName || company.fullName}`,
    `ИНН / ОГРН: ${company.inn || '—'} / ${company.ogrn || '—'}`,
    `Статус / ОКВЭД: ${company.status || '—'} / ${[company.okved, company.okvedName].filter(Boolean).join(' · ') || '—'}`,
  ] : [];
  ui.leadMessage.value = [
    'Заявка после Стройпоиска',
    `Запрос: ${active.query}`,
    `Тип: ${types[active.type].label}`,
    ...companyLines,
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
  if (active.type === 'company') {
    ui.companyProfile.hidden = false;
    if (active.companyProfile?.found) renderCompanyData(active.companyProfile);
    fetchCompanyProfile(Boolean(active.companyProfile?.source?.cached));
  } else if (ui.companyProfile) {
    if (companyRequestController) companyRequestController.abort();
    companyRequestController = null;
    ui.companyProfile.hidden = true;
    ui.companyProfileBody?.replaceChildren();
  }
  active.sources.filter((record) => ['egrz', 'eis'].includes(record.id)).forEach((record) => fetchRegistrySource(record.id, false));
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
    companyProfile: null,
    sources: types[selectedType].sources.map((id) => ({ id, status: 'unchecked', note: '', checkedAt: null, response: null, loading: false })),
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
    if (companyRequestController) companyRequestController.abort();
    companyRequestController = null;
    active = null;
    ui.result.hidden = true;
    if (ui.companyProfile) ui.companyProfile.hidden = true;
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
  const companies = (active.companyProfile?.companies || []).map((company) => ({
    entityType: company.entityType || '',
    shortName: company.shortName || '',
    fullName: company.fullName || '',
    status: company.status || '',
    inn: company.inn || '',
    ogrn: company.ogrn || '',
    registeredAt: company.registeredAt || '',
    ogrnAssignedAt: company.ogrnAssignedAt || '',
    region: company.region || '',
    okved: company.okved || '',
    okvedName: company.okvedName || '',
    reportingYear: company.reportingYear || '',
    reportingPeriod: company.reportingPeriod || '',
    officialFields: Array.isArray(company.officialFields) ? company.officialFields : [],
    documents: (company.documents || []).map((document) => ({
      label: document.label || '',
      url: safeOfficialHref(document.url),
      kind: document.kind || '',
      note: document.note || '',
    })).filter((document) => document.url),
    source: active.companyProfile.source,
  }));
  return {
    schema: 'dnepr-stroypoisk-passport/1.1',
    id: active.id,
    query: active.query,
    queryType: active.type,
    queryTypeLabel: types[active.type].label,
    validation: active.validation,
    createdAt: active.createdAt,
    updatedAt: active.updatedAt,
    projectStage: active.stage,
    nextAction: active.nextAction,
    company: companies[0] || null,
    companies,
    evidence: active.sources.map((record) => ({
      source: sources[record.id].name,
      sourceUrl: sources[record.id].url,
      retrievedAt: record.checkedAt,
      status: record.status,
      statusLabel: statusLabel(record.status),
      note: record.note || '',
      results: Array.isArray(record.response?.results) ? record.response.results : [],
      files: Array.isArray(record.response?.files) ? record.response.files : [],
      diagnosticId: record.response?.diagnosticId || '',
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
  const companies = data.companies.map((company, index) => {
    const documents = company.documents.map((document) => `<li><a href="${escapeHtml(document.url)}">${escapeHtml(document.label)}</a> — ${escapeHtml(document.note || '')}</li>`).join('');
    return `<section><p class="meta">Результат ${index + 1} из ${data.companies.length}</p><h2>${escapeHtml(company.shortName || company.fullName)}</h2><p>${escapeHtml(company.fullName || '')}</p><dl><div><dt>Статус</dt><dd>${escapeHtml(company.status || '—')}</dd></div><div><dt>ИНН</dt><dd>${escapeHtml(company.inn || '—')}</dd></div><div><dt>ОГРН / ОГРНИП</dt><dd>${escapeHtml(company.ogrn || '—')}</dd></div><div><dt>Дата регистрации</dt><dd>${escapeHtml(company.registeredAt || '—')}</dd></div><div><dt>Регион</dt><dd>${escapeHtml(company.region || '—')}</dd></div><div><dt>ОКВЭД</dt><dd>${escapeHtml([company.okved, company.okvedName].filter(Boolean).join(' · ') || '—')}</dd></div></dl>${documents ? `<h3>Документы ФНС</h3><ul>${documents}</ul>` : ''}</section>`;
  }).join('');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>СтройПаспорт ${escapeHtml(data.id)}</title><style>body{font:15px/1.55 Arial,sans-serif;max-width:1100px;margin:auto;padding:44px;color:#111d27}h1{font-size:38px;margin-bottom:8px}section{margin:36px 0}.meta{color:#64717a}dl{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid #d7d9d7}dl div{padding:12px;border-bottom:1px solid #d7d9d7}dt{color:#64717a;font-size:11px;text-transform:uppercase}dd{margin:5px 0 0;font-weight:700}table{width:100%;border-collapse:collapse;margin:30px 0}th,td{text-align:left;padding:12px;border:1px solid #d7d9d7;vertical-align:top}th{background:#111d27;color:#fff}.warning{border-left:5px solid #ffd229;padding:16px;background:#f5f2e8}@media(max-width:700px){body{padding:20px}dl{grid-template-columns:1fr}table{font-size:12px;display:block;overflow:auto}}</style></head><body><h1>СтройПаспорт проверки</h1><p class="meta">${escapeHtml(data.id)} · ${escapeHtml(new Date(data.updatedAt).toLocaleString('ru-RU'))}</p><h2>${escapeHtml(data.query)}</h2><p>${escapeHtml(data.queryTypeLabel)} · ${escapeHtml(data.validation)}</p>${companies}<table><thead><tr><th>Источник</th><th>Статус</th><th>Дата проверки</th><th>Заметка</th><th>Первоисточник</th></tr></thead><tbody>${rows}</tbody></table><p><b>Следующий шаг:</b> ${escapeHtml(data.nextAction)}</p><p class="warning">${escapeHtml(data.disclaimer)}</p></body></html>`;
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
  if (companyRequestController) companyRequestController.abort();
  companyRequestController = null;
  sourceRequestControllers.forEach((controller) => controller.abort());
  sourceRequestControllers.clear();
  active = null;
  ui.result.hidden = true;
  if (ui.companyProfile) ui.companyProfile.hidden = true;
  ui.input.focus();
}));
document.querySelector('[data-search-lead-form]')?.addEventListener('submit', updateLead, true);

renderHistory();
