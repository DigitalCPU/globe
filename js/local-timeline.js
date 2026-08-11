(function () {
  const NEWS_ENDPOINT = 'https://globe-qwen-relay.digitalcomputermail.workers.dev/api/news';
  const CHAT_ENDPOINT = 'https://globe-qwen-relay.digitalcomputermail.workers.dev/api/chat';
  const visibilityKey = 'digitalcpu:local-timeline-visible:v1';
  const collapsedKey = 'digitalcpu:local-timeline-collapsed:v1';
  const opacityKey = 'digitalcpu:local-timeline-opacity:v1';

  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });
  }

  function cleanTitle(title) {
    return String(title || 'Untitled').replace(/\s+-\s+[^-]+$/, '').trim();
  }

  function setLoading(list, text) {
    list.innerHTML = '';
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  }

  function renderItems(list, items) {
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No verified local items found yet.';
      list.appendChild(empty);
      return;
    }

    items.forEach((entry) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = entry.link || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = cleanTitle(entry.title);
      item.appendChild(link);

      const meta = document.createElement('cite');
      const bits = [formatDate(entry.published), entry.source].filter(Boolean);
      if (bits.length) {
        meta.textContent = ` ${bits.join(' / ')}`;
        item.appendChild(document.createElement('br'));
        item.appendChild(meta);
      }
      list.appendChild(item);
    });
  }

  async function fetchNews(location, mode) {
    const params = new URLSearchParams({
      lat: String(location.lat),
      lon: String(location.lon),
      mode
    });
    const response = await fetch(`${NEWS_ENDPOINT}?${params.toString()}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `News request failed: ${response.status}`);
    return body;
  }

  async function summarizeItems(items, place, mode) {
    const sourceLines = items.slice(0, 8).map((item, index) => {
      const date = formatDate(item.published) || 'unknown date';
      return `${index + 1}. ${date} - ${cleanTitle(item.title)} (${item.source || 'source unknown'})`;
    }).join('\n');
    const prompt = [
      `Summarize these verified ${mode === 'history' ? 'same-date historical/local' : 'recent local'} news results for ${place}.`,
      'Use only these source titles. Do not add events that are not listed.',
      'Keep it under 90 words.',
      sourceLines
    ].join('\n\n');

    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-4b-instruct-2507-q5_k_m',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 180,
        temperature: 0.2
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Qwen summary failed: ${response.status}`);
    return body.reply || (body.choices && body.choices[0] && body.choices[0].message.content) || '';
  }

  function initTimeline() {
    const widget = $('timelineWidget');
    const list = $('timelineList');
    const placeLabel = $('timelinePlace');
    const refreshButton = $('timelineRefresh');
    const toggleButton = $('timelineToggle');
    const opacityInput = $('timelineOpacity');
    const opacityValue = $('timelineOpacityValue');
    const recentButton = $('timelineRecent');
    const historyButton = $('timelineHistory');
    const summarizeButton = $('timelineSummarize');
    const summary = $('timelineSummary');
    const showInput = $('showTimeline');

    if (!widget || !list || !placeLabel || !refreshButton || !toggleButton || !opacityInput || !opacityValue || !recentButton || !historyButton || !summarizeButton) return;

    const state = {
      location: null,
      mode: 'recent',
      place: '',
      items: []
    };

    function setVisible(visible) {
      widget.classList.toggle('is-hidden', !visible);
      if (showInput) showInput.checked = visible;
      localStorage.setItem(visibilityKey, visible ? '1' : '0');
    }

    function setCollapsed(collapsed) {
      widget.classList.toggle('is-collapsed', collapsed);
      toggleButton.textContent = collapsed ? '+' : '-';
      toggleButton.setAttribute('aria-expanded', String(!collapsed));
      toggleButton.setAttribute('aria-label', collapsed ? 'Expand news feed' : 'Minimize news feed');
      localStorage.setItem(collapsedKey, collapsed ? '1' : '0');
    }

    function setOpacity(value) {
      const numeric = Math.min(95, Math.max(35, Number(value) || 70));
      const opacity = numeric / 100;
      widget.style.setProperty('--timeline-opacity', opacity.toFixed(2));
      opacityInput.value = String(numeric);
      opacityValue.textContent = `${numeric}%`;
      localStorage.setItem(opacityKey, String(numeric));
    }

    function setMode(mode) {
      state.mode = mode;
      recentButton.classList.toggle('is-active', mode === 'recent');
      historyButton.classList.toggle('is-active', mode === 'history');
      summary.hidden = true;
      summary.textContent = '';
      loadTimeline();
    }

    async function loadTimeline() {
      if (!state.location) {
        placeLabel.textContent = 'set location';
        setLoading(list, 'Use location to load local headlines.');
        return;
      }

      setLoading(list, state.mode === 'history' ? 'Searching this day in local news...' : 'Loading local headlines...');
      try {
        const data = await fetchNews(state.location, state.mode);
        state.place = data.place || `${state.location.lat.toFixed(2)}, ${state.location.lon.toFixed(2)}`;
        state.items = Array.isArray(data.items) ? data.items : [];
        placeLabel.textContent = state.mode === 'history'
          ? `${state.place} / this day`
          : state.place;
        renderItems(list, state.items);
      } catch (error) {
        console.warn('Could not load local timeline.', error);
        placeLabel.textContent = 'news unavailable';
        setLoading(list, error.message || 'News unavailable.');
      }
    }

    refreshButton.addEventListener('click', loadTimeline);
    toggleButton.addEventListener('click', () => {
      setCollapsed(!widget.classList.contains('is-collapsed'));
    });
    opacityInput.addEventListener('input', () => setOpacity(opacityInput.value));
    recentButton.addEventListener('click', () => setMode('recent'));
    historyButton.addEventListener('click', () => setMode('history'));
    summarizeButton.addEventListener('click', async () => {
      if (!state.items.length) {
        summary.hidden = false;
        summary.textContent = 'Load timeline items before asking Qwen.';
        return;
      }
      summary.hidden = false;
      summary.textContent = 'Qwen summarizing source items...';
      try {
        summary.textContent = await summarizeItems(state.items, state.place, state.mode);
      } catch (error) {
        summary.textContent = error.message || 'Qwen summary unavailable.';
      }
    });

    if (showInput) {
      showInput.addEventListener('change', () => setVisible(showInput.checked));
    }

    window.addEventListener('globe:user-location', (event) => {
      const detail = event.detail || {};
      const lat = Number(detail.lat);
      const lon = Number(detail.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      state.location = { lat, lon };
      loadTimeline();
    });

    setVisible(localStorage.getItem(visibilityKey) !== '0');
    setCollapsed(localStorage.getItem(collapsedKey) === '1');
    setOpacity(localStorage.getItem(opacityKey) || opacityInput.value);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimeline);
  } else {
    initTimeline();
  }
}());
