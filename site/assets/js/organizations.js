(() => {
  const input = document.querySelector('#organization-search');
  const button = document.querySelector('[data-organization-search-button]');
  const status = document.querySelector('[data-organization-search-status]');
  const results = document.querySelector('[data-organization-search-results]');
  if (!input || !button || !status || !results) return;

  let directory = null;
  const normalize = (value) => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  const loadDirectory = async () => {
    if (directory) return directory;
    status.textContent = 'Загружаю справочник…';
    const response = await fetch('/organizations/index.json?v=20260914-org1', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    directory = Array.isArray(payload.items) ? payload.items : [];
    return directory;
  };

  const render = (items, query) => {
    results.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'org-search-empty';
      empty.textContent = `По запросу «${query}» ничего не найдено. Попробуйте название без организационно-правовой формы или укажите город.`;
      results.append(empty);
      status.textContent = 'Совпадений нет.';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const link = document.createElement('a');
      link.className = 'org-search-result';
      link.href = item.url;
      const title = document.createElement('strong');
      title.textContent = item.name;
      const place = document.createElement('span');
      place.textContent = `${item.city} · ${item.district}`;
      const profile = document.createElement('span');
      profile.textContent = item.profile;
      link.append(title, place, profile);
      fragment.append(link);
    });
    results.append(fragment);
    status.textContent = `Показано: ${items.length}.`;
  };

  const search = async () => {
    const query = normalize(input.value);
    if (query.length < 2) {
      results.replaceChildren();
      status.textContent = 'Введите минимум два символа.';
      return;
    }

    button.disabled = true;
    try {
      const items = await loadDirectory();
      const words = query.split(' ').filter(Boolean);
      const matches = [];
      for (const item of items) {
        const haystack = normalize(`${item.name} ${item.city} ${item.district} ${item.profile}`);
        if (words.every((word) => haystack.includes(word))) matches.push(item);
        if (matches.length === 30) break;
      }
      render(matches, input.value.trim());
    } catch (error) {
      results.replaceChildren();
      status.textContent = 'Справочник временно не загрузился. Откройте каталог региона ниже.';
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', search);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });
})();
