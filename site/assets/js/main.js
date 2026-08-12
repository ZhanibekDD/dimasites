(() => {
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('.main-nav');

  const pushAnalytics = (event, data = {}) => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...data });
  };

  const currentParams = new URLSearchParams(window.location.search);
  const attributionKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'yclid'];
  let storedAttribution = {};
  try {
    storedAttribution = JSON.parse(window.sessionStorage.getItem('dnepr_attribution') || '{}');
  } catch (_) {
    storedAttribution = {};
  }
  attributionKeys.forEach((key) => {
    const value = currentParams.get(key);
    if (value) storedAttribution[key] = value.slice(0, 200);
  });
  if (!storedAttribution.landing_page) storedAttribution.landing_page = window.location.href.slice(0, 500);
  if (!storedAttribution.referrer && document.referrer) {
    try {
      const referrerUrl = new URL(document.referrer);
      if (referrerUrl.hostname !== window.location.hostname) storedAttribution.referrer = document.referrer.slice(0, 500);
    } catch (_) {
      storedAttribution.referrer = document.referrer.slice(0, 500);
    }
  }
  try {
    window.sessionStorage.setItem('dnepr_attribution', JSON.stringify(storedAttribution));
  } catch (_) {
    // The site remains fully functional when storage is disabled.
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('tel:')) {
      pushAnalytics('phone_click', { phone_number: href.replace('tel:', ''), link_text: link.textContent.trim().slice(0, 120), page_path: window.location.pathname });
      return;
    }
    if (href.startsWith('mailto:')) {
      pushAnalytics('email_click', { email_address: href.replace('mailto:', ''), page_path: window.location.pathname });
      return;
    }
    if (link.matches('.button, .header-cta, .knowledge-card, .knowledge-list-card a')) {
      pushAnalytics('cta_click', { link_text: link.textContent.trim().slice(0, 120), link_url: link.href.slice(0, 500), page_path: window.location.pathname });
    }
  });

  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 24);
  };

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const updateScrollProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    document.body.style.setProperty('--scroll-progress', progress.toFixed(4));
  };

  updateScrollProgress();
  window.addEventListener('scroll', updateScrollProgress, { passive: true });

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      document.body.classList.toggle('menu-open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      menuButton.textContent = open ? '×' : '☰';
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        document.body.classList.remove('menu-open');
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.setAttribute('aria-label', 'Открыть меню');
        menuButton.textContent = '☰';
      });
    });
  }

  const mobileActionBar = document.createElement('nav');
  mobileActionBar.className = 'mobile-action-bar';
  mobileActionBar.setAttribute('aria-label', 'Быстрые действия');
  const auditHref = document.querySelector('#audit') ? '#audit' : '/#audit';
  const analyzerHref = document.querySelector('#analyzer') ? '#analyzer' : null;
  const searchHref = document.querySelector('[data-search-form]') ? '#search' : null;
  const toolHref = searchHref || analyzerHref || auditHref;
  const toolLabel = searchHref ? 'Стройпоиск' : analyzerHref ? 'Проверить документ' : 'Оценить проект';
  mobileActionBar.innerHTML = `<a href="tel:+73496453002">Позвонить</a><a href="${toolHref}">${toolLabel}</a>`;
  document.body.append(mobileActionBar);

  if (!window.location.pathname.startsWith('/admin/')) {
    const callDock = document.createElement('aside');
    callDock.className = 'call-dock';
    callDock.setAttribute('aria-label', 'Позвонить в ДНЕПР');
    callDock.innerHTML = '<div class="call-dock-copy"><span>Есть объект или ТЗ?</span><strong>Обсудить напрямую</strong></div><a href="tel:+73496453002">Позвонить</a><button class="call-dock-close" type="button" aria-label="Закрыть">×</button>';
    document.body.append(callDock);
    let dockDismissed = false;
    try { dockDismissed = window.sessionStorage.getItem('dnepr_call_dock_closed') === '1'; } catch (_) { dockDismissed = false; }
    const updateCallDock = () => callDock.classList.toggle('is-visible', !dockDismissed && window.scrollY > Math.min(600, window.innerHeight * .65));
    callDock.querySelector('.call-dock-close').addEventListener('click', () => {
      dockDismissed = true;
      callDock.classList.remove('is-visible');
      try { window.sessionStorage.setItem('dnepr_call_dock_closed', '1'); } catch (_) { /* no-op */ }
    });
    updateCallDock();
    window.addEventListener('scroll', updateCallDock, { passive: true });
  }

  const revealItems = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const precisionPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const motionAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (precisionPointer.matches && motionAllowed) {
    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('pointermove', (event) => {
        const x = (event.clientX / window.innerWidth - 0.5) * -12;
        const y = (event.clientY / window.innerHeight - 0.5) * -8;
        hero.style.setProperty('--hero-shift-x', `${x.toFixed(2)}px`);
        hero.style.setProperty('--hero-shift-y', `${y.toFixed(2)}px`);
      });

      hero.addEventListener('pointerleave', () => {
        hero.style.setProperty('--hero-shift-x', '0px');
        hero.style.setProperty('--hero-shift-y', '0px');
      });
    }

    document.querySelectorAll('[data-service-card]').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
        card.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`);
        card.style.setProperty('--tilt-x', `${((0.5 - y) * 4).toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${((x - 0.5) * 5).toFixed(2)}deg`);
      });

      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--spot-x', '50%');
        card.style.setProperty('--spot-y', '38%');
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
    });
  }

  document.querySelectorAll('[data-project-audit]').forEach((audit) => {
    const steps = Array.from(audit.querySelectorAll('[data-audit-step]'));
    const result = audit.querySelector('[data-audit-result]');
    const controls = audit.querySelector('[data-audit-controls]');
    const next = audit.querySelector('[data-audit-next]');
    const back = audit.querySelector('[data-audit-back]');
    const counter = audit.querySelector('[data-audit-counter]');
    const progress = audit.querySelector('.audit-progress');
    let current = 0;

    const showStep = (index) => {
      current = Math.max(0, Math.min(steps.length - 1, index));
      steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== current; });
      result.hidden = true;
      controls.hidden = false;
      back.disabled = current === 0;
      counter.textContent = `${current + 1} из ${steps.length}`;
      progress.style.setProperty('--audit-progress', `${((current + 1) / steps.length) * 100}%`);
      audit.querySelector('.audit-panel-head > span').textContent = `PROJECT READINESS / 0${current + 1}`;
    };

    const stepIsValid = (step) => {
      const requiredGroups = new Set();
      step.querySelectorAll('input[required]').forEach((input) => requiredGroups.add(input.name));
      return Array.from(requiredGroups).every((name) => step.querySelector(`input[name="${name}"]:checked`));
    };

    const calculate = () => {
      const checked = Array.from(audit.querySelectorAll('[data-score]:checked'));
      const score = Math.min(100, checked.reduce((sum, input) => sum + Number(input.dataset.score || 0), 0));
      const type = audit.querySelector('[name="audit_type"]:checked')?.value || 'не указано';
      const stage = audit.querySelector('[name="audit_stage"]:checked')?.value || 'не указана';
      const timing = audit.querySelector('[name="audit_timing"]:checked')?.value || 'не указан';
      const docs = Array.from(audit.querySelectorAll('[name="audit_docs[]"]:checked')).map((input) => input.value);
      const title = audit.querySelector('[data-audit-title]');
      const advice = audit.querySelector('[data-audit-advice]');

      if (score >= 75) {
        title.textContent = 'Высокая готовность к техническому старту';
        advice.textContent = 'Можно переходить к проверке объёмов, границ ответственности, ресурсов и календарного графика.';
      } else if (score >= 45) {
        title.textContent = 'Проект готов к технической сборке';
        advice.textContent = 'Есть основа для работы. Следующий шаг — закрыть пробелы в исходных данных и уточнить состав работ.';
      } else {
        title.textContent = 'Сначала нужно собрать исходные данные';
        advice.textContent = 'Это нормальная ранняя стадия. Сформируем короткий перечень документов, чтобы не терять время на старте.';
      }

      audit.querySelector('[data-audit-score]').textContent = String(score);
      audit.querySelector('[data-audit-gauge]').style.setProperty('--audit-score', '0%');
      audit.querySelector('[data-audit-message]').value = [
        'Инженерный экспресс-аудит',
        `Индекс готовности: ${score}%`,
        `Тип проекта: ${type}`,
        `Стадия: ${stage}`,
        `Материалы: ${docs.length ? docs.join(', ') : 'не выбраны'}`,
        `Планируемый старт: ${timing}`,
        'Просьба связаться и подсказать следующий технический шаг.'
      ].join('\n');

      steps.forEach((step) => { step.hidden = true; });
      controls.hidden = true;
      result.hidden = false;
      counter.textContent = 'Результат';
      progress.style.setProperty('--audit-progress', '100%');
      audit.querySelector('.audit-panel-head > span').textContent = 'PROJECT READINESS / RESULT';
      requestAnimationFrame(() => audit.querySelector('[data-audit-gauge]').style.setProperty('--audit-score', `${score}%`));
    };

    next.addEventListener('click', () => {
      if (!stepIsValid(steps[current])) {
        audit.classList.remove('is-invalid');
        void audit.offsetWidth;
        audit.classList.add('is-invalid');
        steps[current].querySelector('input')?.focus();
        return;
      }
      audit.classList.remove('is-invalid');
      if (current === steps.length - 1) calculate();
      else showStep(current + 1);
    });

    back.addEventListener('click', () => showStep(current - 1));
    audit.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => audit.classList.remove('is-invalid')));
    showStep(0);
  });

  document.querySelectorAll('[data-contact-form]').forEach((form) => {
    const attribution = {
      page_url: window.location.href.slice(0, 500),
      landing_page: (storedAttribution.landing_page || '').slice(0, 500),
      referrer: (storedAttribution.referrer || '').slice(0, 500),
      utm_source: (storedAttribution.utm_source || '').slice(0, 120),
      utm_medium: (storedAttribution.utm_medium || '').slice(0, 120),
      utm_campaign: (storedAttribution.utm_campaign || '').slice(0, 160),
      utm_term: (storedAttribution.utm_term || '').slice(0, 160),
      utm_content: (storedAttribution.utm_content || '').slice(0, 160),
      gclid: (storedAttribution.gclid || '').slice(0, 200),
      yclid: (storedAttribution.yclid || '').slice(0, 200)
    };
    Object.entries(attribution).forEach(([name, value]) => {
      if (form.elements.namedItem(name)) return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.append(input);
    });

    let formStarted = false;
    form.addEventListener('focusin', () => {
      if (formStarted) return;
      formStarted = true;
      pushAnalytics('form_start', { form_source: form.querySelector('[name="source"]')?.value || 'Форма сайта', page_path: window.location.pathname });
    });

    const status = form.querySelector('.form-status');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Отправляем…';
      status.textContent = '';
      status.className = 'form-status';

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Не удалось отправить заявку.');
        form.reset();
        status.textContent = result.message || 'Заявка отправлена. Мы свяжемся с вами.';
        status.classList.add('success');
        pushAnalytics('generate_lead', {
          form_source: form.querySelector('[name="source"]')?.value || 'Форма сайта',
          lead_id: result.lead_id || '',
          lead_score: Number(result.lead_score || 0),
          lead_priority: result.priority || 'standard'
        });
      } catch (error) {
        status.textContent = `${error.message} Позвоните по телефону +7 (3496) 45-30-02.`;
        status.classList.add('error');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
})();
