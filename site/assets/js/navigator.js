(function () {
  'use strict';

  var root = document.querySelector('[data-navigator]');
  if (!root) return;

  var regions = {
    yanao: {
      name: 'Ямало-Ненецкий автономный округ',
      code: 'ЯНАО',
      source: {
        name: 'Официальный портал ЯНАО',
        url: 'https://yanao.ru/',
        note: 'Найдите профильный орган или муниципалитет по месту объекта.'
      }
    },
    hmao: {
      name: 'Ханты-Мансийский автономный округ — Югра',
      code: 'ХМАО',
      source: {
        name: 'Официальный портал Югры',
        url: 'https://admhmao.ru/',
        note: 'Проверьте полномочия окружного или муниципального органа.'
      }
    },
    tyumen: {
      name: 'Тюменская область',
      code: 'ТМН',
      source: {
        name: 'Выдача разрешения на строительство — Тюменская область',
        url: 'https://lk.admtyumen.ru/lk/catalog/grServices/service.htm?dep=8578%40egOrganization&id=11979%40egServiceTarget',
        note: 'Официальная карточка услуги с составом документов и результатом.'
      }
    }
  };

  var sources = {
    nspd: {
      name: 'Национальная система пространственных данных',
      url: 'https://nspd.gov.ru/map',
      note: 'Публичная карта для первичной проверки участка и пространственных ограничений.'
    },
    egrz: {
      name: 'ГИС ЕГРЗ',
      url: 'https://egrz.ru/',
      note: 'Единый государственный реестр заключений экспертизы проектной документации.'
    },
    eis: {
      name: 'ЕИС в сфере закупок',
      url: 'https://zakupki.gov.ru/epz/main/public/home.html',
      note: 'Извещения, документация, изменения, протоколы и сведения о контракте.'
    },
    nostroy: {
      name: 'Единый реестр НОСТРОЙ',
      url: 'https://reestr.nostroy.ru/',
      note: 'Проверка членства строительной организации в СРО.'
    },
    nopriz: {
      name: 'Национальный реестр специалистов НОПРИЗ',
      url: 'https://nrs.nopriz.ru/',
      note: 'Проверка специалистов в области инженерных изысканий и проектирования.'
    },
    opor: {
      name: 'Реестр ОПО Ростехнадзора',
      url: 'https://www.gosnadzor.ru/service/State%20services/register_OPO/',
      note: 'Официальный раздел регистрации опасных производственных объектов.'
    },
    analyzer: {
      name: 'Анализ документа на замечания',
      url: '/proverka/',
      note: 'Локальный разбор PDF, DOCX, XLSX и изображений в браузере.'
    },
    search: {
      name: 'Стройпоиск ДНЕПР',
      url: '/proverka/poisk/',
      note: 'Проверка компании по ИНН/ОГРН и построение строительного следа.'
    }
  };

  var tasks = {
    land: {
      code: 'LAND',
      title: 'Участок и градостроительные ограничения',
      intro: 'Соберите доказуемую исходную картину участка до заказа изысканий и проектирования.',
      steps: [
        ['Зафиксировать идентификатор участка', 'Кадастровый номер, адрес, правообладатель, категория земли и предполагаемый вид объекта.'],
        ['Проверить участок на публичной карте НСПД', 'Сверить границы, разрешённое использование и видимые зоны с особыми условиями использования.'],
        ['Получить актуальные сведения ЕГРН', 'Публичная карта не заменяет официальную выписку и правовую проверку.'],
        ['Определить требуемый градостроительный документ', 'ГПЗУ — для площадного объекта; ППТ/ПМТ и иные документы — по ситуации с линейным объектом.'],
        ['Собрать технические условия и ограничения', 'Подключения, охранные зоны, санитарные, экологические и промышленные требования.'],
        ['Создать паспорт исходных данных', 'Сохранить URL, дату получения, номер записи и версию каждого документа.']
      ],
      sources: ['nspd'],
      next: 'Передать участок инженеру для матрицы ограничений и состава изысканий.'
    },
    project: {
      code: 'PROJ',
      title: 'Подготовка проектной документации',
      intro: 'Маршрут от исходных данных до комплекта, готового к проверке и экспертизе.',
      steps: [
        ['Утвердить техническое задание', 'Назначение объекта, производительность, границы проектирования, сроки и критерии результата.'],
        ['Провести аудит исходно-разрешительной документации', 'Права на землю, ГПЗУ или документация по планировке, технические условия и обследования.'],
        ['Определить состав инженерных изысканий', 'Привязать виды и объём изысканий к объекту, площадке и требованиям экспертизы.'],
        ['Проверить проектную команду', 'Зафиксировать организацию, ответственных специалистов и записи в профильных реестрах.'],
        ['Сформировать и согласовать проектные решения', 'Разделы, интерфейсы, смежные решения, специальные технические условия — при необходимости.'],
        ['Провести внутреннюю проверку комплекта', 'Коллизии, ссылки, подписи, форматы, смета и соответствие техническому заданию.'],
        ['Подготовить пакет к экспертизе', 'Определить вид экспертизы, заявителя, формат подачи и перечень приложений.']
      ],
      sources: ['nopriz', 'egrz'],
      next: 'Заказать аудит готовности проектной документации перед подачей.'
    },
    expertise: {
      code: 'EXPR',
      title: 'Экспертиза проектной документации',
      intro: 'Контрольная последовательность для первой подачи или устранения замечаний экспертизы.',
      steps: [
        ['Определить вид и предмет экспертизы', 'Государственная или негосударственная; проектная документация, изыскания, смета — по применимым требованиям.'],
        ['Проверить комплектность заявления', 'Форматы, подписи, полномочия заявителя, исходные документы и идентификаторы объекта.'],
        ['Провести предэкспертный аудит', 'Проверить согласованность разделов и устранить очевидные основания для возврата.'],
        ['Зарегистрировать подачу и доказательства', 'Номер заявления, дата, состав переданного комплекта и версия каждого файла.'],
        ['Разобрать замечания по ответственным', 'Категория, раздел, страница, цитата, срок, ответственный и статус устранения.'],
        ['Проверить повторную выдачу комплекта', 'Изменённые решения не должны создавать противоречия в смежных разделах.'],
        ['Проверить итоговое заключение в ЕГРЗ', 'Сверить номер, объект, участников, дату и статус с официальной записью.']
      ],
      sources: ['egrz', 'analyzer'],
      next: 'Загрузить замечания и получить структурированный план устранения.'
    },
    permit: {
      code: 'PERM',
      title: 'Разрешение на строительство',
      intro: 'Проверка основания, проекта и заявления до обращения в уполномоченный орган.',
      steps: [
        ['Определить уполномоченный орган', 'Полномочия зависят от территории, вида объекта и уровня его значения.'],
        ['Проверить права на земельный участок', 'Документ-основание, границы и соответствие заявителя.'],
        ['Сверить ГПЗУ или документацию по планировке', 'Использовать актуальную версию и учитывать требования к линейным объектам.'],
        ['Проверить проект и положительное заключение', 'Сопоставить объект, основные параметры и идентификаторы в комплекте.'],
        ['Собрать заявление и приложения', 'Применять актуальный перечень из официальной карточки региональной услуги.'],
        ['Зафиксировать подачу', 'Номер, дата, канал подачи, опись и контрольный срок.'],
        ['Проверить результат и условия разрешения', 'Срок действия, этапы, параметры и возможные обязательства до начала работ.']
      ],
      sources: ['nspd', 'egrz'],
      next: 'Передать комплект на проверку готовности к получению разрешения.'
    },
    construction: {
      code: 'BUILD',
      title: 'Старт строительства или реконструкции',
      intro: 'Организационная готовность площадки, подрядчика и исполнительной документации.',
      steps: [
        ['Сверить разрешение, проект и границы работ', 'Команда должна работать по утверждённой и идентифицированной версии документации.'],
        ['Проверить подрядчика и требуемое членство СРО', 'Зафиксировать официальную запись на дату заключения договора и начала работ.'],
        ['Назначить ответственных и строительный контроль', 'Приказы, полномочия, журналы и схема взаимодействия участников.'],
        ['Подготовить площадку и допуски', 'ПОС/ППР, временная инфраструктура, охрана труда, промышленная и пожарная безопасность.'],
        ['Подать обязательные уведомления', 'Состав и адресат зависят от объекта и вида государственного строительного надзора.'],
        ['Открыть контур исполнительной документации', 'Журналы, акты скрытых работ, схемы, паспорта, лабораторные протоколы и версии.'],
        ['Проверить требования к ОПО', 'Для применимых объектов — регистрация, лицензии и мероприятия промышленной безопасности.']
      ],
      sources: ['nostroy', 'opor'],
      next: 'Запросить мобилизационный план и матрицу готовности площадки.'
    },
    procurement: {
      code: 'PROC',
      title: 'Закупка и допуск подрядчика',
      intro: 'Проверка документации закупки, сроков, требований и изменений перед решением об участии.',
      steps: [
        ['Открыть официальную карточку закупки в ЕИС', 'Сверить номер, заказчика, предмет, регион, начальную цену и способ определения поставщика.'],
        ['Скачать актуальную редакцию документов', 'Сохранить дату, версию и контрольную сумму локального комплекта.'],
        ['Собрать календарь процедуры', 'Окончание подачи, запросы разъяснений, обеспечение, рассмотрение и исполнение.'],
        ['Проверить квалификационные требования', 'СРО, опыт, специалисты, лицензии, техника, финансовые и специальные условия.'],
        ['Разобрать техническое задание и объёмы', 'Найти расхождения, неопределённости, риски цены и вопросы заказчику.'],
        ['Проверить изменения и разъяснения', 'Повторить проверку перед подачей: документация и сроки могут измениться.'],
        ['Сформировать решение об участии', 'Маржинальность, ресурсы, риски, партнёры, ответственные и срок внутреннего согласования.']
      ],
      sources: ['eis', 'nostroy', 'analyzer'],
      next: 'Передать закупку на инженерно-коммерческий экспресс-разбор.'
    },
    commissioning: {
      code: 'COMM',
      title: 'Подготовка ввода в эксплуатацию',
      intro: 'Сбор доказательств соответствия построенного объекта проекту и требованиям разрешения.',
      steps: [
        ['Сверить построенный объект с разрешением и проектом', 'Зафиксировать согласованные изменения и исполнительные решения.'],
        ['Закрыть исполнительную документацию', 'Акты, журналы, схемы, сертификаты, испытания и документы на оборудование.'],
        ['Завершить пусконаладку и испытания', 'Программы, протоколы, режимы, замечания и подтверждение устранения.'],
        ['Получить обязательные заключения и акты', 'Состав зависит от вида объекта, надзора, сетей и специальных требований.'],
        ['Проверить готовность ОПО', 'Регистрация, лицензирование, производственный контроль и документация — если применимо.'],
        ['Подготовить заявление на ввод', 'Использовать актуальную карточку услуги и опись передаваемого комплекта.'],
        ['Зафиксировать разрешение и обновить реестры', 'Номер, дата, параметры объекта, технический план и дальнейшие эксплуатационные обязанности.']
      ],
      sources: ['egrz', 'opor'],
      next: 'Заказать аудит исполнительной документации и готовности к ПНР.'
    },
    refusal: {
      code: 'FIX',
      title: 'Отказ, предписание или замечания',
      intro: 'Из доказательства проблемы — в контролируемый план устранения и повторной подачи.',
      steps: [
        ['Сохранить исходный документ без изменений', 'Зафиксировать источник, номер, дату, канал получения и срок ответа или обжалования.'],
        ['Извлечь все замечания с привязкой к странице', 'Не пересказывать: хранить точную цитату, категорию и контекст.'],
        ['Разделить факты, требования и гипотезы', 'Автоматическая классификация требует проверки ответственным инженером.'],
        ['Проверить правовое и техническое основание', 'Сопоставить замечание с актуальной редакцией документа и исходными данными.'],
        ['Назначить ответственных и зависимости', 'Проектировщик, заказчик, изыскатель, подрядчик или орган — без потери межраздельных связей.'],
        ['Собрать доказательство устранения', 'Новая версия, пояснение, расчёт, согласование и ссылка на изменённое место.'],
        ['Провести контрольную проверку и повторную подачу', 'Опись комплекта, версии файлов, ответ на каждое замечание и контрольный срок.']
      ],
      sources: ['analyzer', 'egrz'],
      next: 'Загрузить документ и получить предварительную карту замечаний.'
    }
  };

  var form = root.querySelector('[data-navigator-form]');
  var regionSelect = root.querySelector('[data-region]');
  var taskSelect = root.querySelector('[data-task]');
  var error = root.querySelector('[data-navigator-error]');
  var result = root.querySelector('[data-navigator-result]');
  var title = root.querySelector('[data-route-title]');
  var intro = root.querySelector('[data-route-intro]');
  var code = root.querySelector('[data-route-code]');
  var stepsNode = root.querySelector('[data-route-steps]');
  var sourcesNode = root.querySelector('[data-route-sources]');
  var progressBar = root.querySelector('[data-route-progress]');
  var progressLabel = root.querySelector('[data-route-progress-label]');
  var message = root.querySelector('[data-navigator-message]');
  var status = root.querySelector('[data-route-status]');
  var current = null;
  var completed = {};

  function officialSources(region, task) {
    var list = [region.source];
    task.sources.forEach(function (key) { list.push(sources[key]); });
    return list;
  }

  function updateLeadMessage() {
    if (!current || !message) return;
    var done = [];
    current.task.steps.forEach(function (step, index) {
      if (completed[index]) done.push((index + 1) + '. ' + step[0]);
    });
    var sourceLines = current.sources.map(function (source) { return '- ' + source.name + ': ' + source.url; });
    message.value = [
      'Маршрут государственного навигатора',
      'Регион: ' + current.region.name,
      'Задача: ' + current.task.title,
      'Код маршрута: ' + current.routeCode,
      'Выполнено: ' + done.length + ' из ' + current.task.steps.length,
      done.length ? 'Отмеченные пункты:\n' + done.join('\n') : 'Отмеченные пункты: нет',
      'Рекомендуемый следующий шаг: ' + current.task.next,
      'Официальные источники:\n' + sourceLines.join('\n')
    ].join('\n\n');
  }

  function updateProgress() {
    if (!current) return;
    var done = Object.keys(completed).filter(function (key) { return completed[key]; }).length;
    var total = current.task.steps.length;
    progressBar.style.width = Math.round(done / total * 100) + '%';
    progressLabel.textContent = done + ' из ' + total + ' выполнено';
    updateLeadMessage();
  }

  function buildRoute(regionKey, taskKey) {
    var region = regions[regionKey];
    var task = tasks[taskKey];
    var routeCode = region.code + '-' + task.code + '-' + String(new Date().getFullYear()).slice(-2);
    completed = {};
    current = { region: region, task: task, routeCode: routeCode, sources: officialSources(region, task) };

    title.textContent = task.title + ' · ' + region.code;
    intro.textContent = task.intro + ' Следующий шаг: ' + task.next;
    code.textContent = routeCode;
    stepsNode.innerHTML = '';
    task.steps.forEach(function (step, index) {
      var item = document.createElement('li');
      item.innerHTML = '<label><input type="checkbox" data-route-check="' + index + '"><span class="route-index">' + String(index + 1).padStart(2, '0') + '</span><span class="route-copy"><strong>' + step[0] + '</strong><small>' + step[1] + '</small></span><i aria-hidden="true">✓</i></label>';
      stepsNode.appendChild(item);
    });

    sourcesNode.innerHTML = '';
    current.sources.forEach(function (source, index) {
      var link = document.createElement('a');
      link.href = source.url;
      link.target = source.url.charAt(0) === '/' ? '_self' : '_blank';
      if (link.target === '_blank') link.rel = 'noopener noreferrer';
      link.innerHTML = '<span>' + String(index + 1).padStart(2, '0') + '</span><b>' + source.name + '</b><small>' + source.note + '</small><i aria-hidden="true">↗</i>';
      sourcesNode.appendChild(link);
    });

    result.hidden = false;
    error.hidden = true;
    status.textContent = '';
    updateProgress();
    window.setTimeout(function () { result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'navigator_route_created', region: region.code, task: taskKey, route_code: routeCode });
  }

  function routeText() {
    if (!current) return '';
    var lines = ['ДНЕПР · ГОСУДАРСТВЕННЫЙ НАВИГАТОР', current.routeCode, '', current.region.name, current.task.title, '', current.task.intro, ''];
    current.task.steps.forEach(function (step, index) {
      lines.push((completed[index] ? '[x] ' : '[ ] ') + (index + 1) + '. ' + step[0]);
      lines.push('    ' + step[1]);
    });
    lines.push('', 'Следующий шаг: ' + current.task.next, '', 'Официальные источники:');
    current.sources.forEach(function (source) { lines.push('- ' + source.name + ': ' + source.url); });
    lines.push('', 'Сформировано: ' + new Date().toLocaleString('ru-RU'), 'Важно: отсутствие записи в подключённом источнике не доказывает отсутствие документа.');
    return lines.join('\n');
  }

  function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function downloadReport() {
    if (!current) return;
    var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>' + escapeHtml(current.routeCode) + '</title><style>body{max-width:900px;margin:48px auto;padding:0 28px;font:16px/1.55 Arial;color:#111a22}h1{font-size:36px}pre{white-space:pre-wrap;background:#f4f1ea;padding:28px;border-left:6px solid #ffd429}</style></head><body><h1>Маршрут строительного проекта</h1><pre>' + escapeHtml(routeText()) + '</pre></body></html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dnepr-route-' + current.routeCode.toLowerCase() + '.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 500);
    status.textContent = 'Отчёт скачан';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!regions[regionSelect.value] || !tasks[taskSelect.value]) {
      error.textContent = 'Выберите регион и текущую задачу объекта.';
      error.hidden = false;
      return;
    }
    buildRoute(regionSelect.value, taskSelect.value);
  });

  stepsNode.addEventListener('change', function (event) {
    var check = event.target.closest('[data-route-check]');
    if (!check) return;
    completed[check.getAttribute('data-route-check')] = check.checked;
    check.closest('li').classList.toggle('is-complete', check.checked);
    updateProgress();
  });

  root.querySelector('[data-route-copy]').addEventListener('click', function () {
    var text = routeText();
    var done = function () { status.textContent = 'Маршрут скопирован'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { status.textContent = 'Не удалось скопировать'; });
    } else {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    }
  });

  root.querySelector('[data-route-download]').addEventListener('click', downloadReport);
  root.querySelector('[data-route-reset]').addEventListener('click', function () {
    result.hidden = true;
    current = null;
    completed = {};
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    regionSelect.focus();
  });
}());
