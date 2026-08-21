(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const API_BASE = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '' : RELAY_BASE;
  const NEWS_ENDPOINT = `${API_BASE}/api/news`;
  const GEOCODE_ENDPOINT = `${API_BASE}/api/geocode`;
  const CHAT_ENDPOINT = `${API_BASE}/api/chat`;
  const visibilityKey = 'digitalcpu:local-timeline-visible:v1';
  const collapsedKey = 'digitalcpu:local-timeline-collapsed:v1';
  const opacityKey = 'digitalcpu:local-timeline-opacity:v1';
  const linksKey = 'digitalcpu:local-timeline-links:v1';

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

  function newsMeta(entry) {
    return [formatDate(entry.published), entry.source].filter(Boolean).join(' / ');
  }

  function renderItems(list, items, allowLinks, onSelect) {
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No verified local items found yet.';
      list.appendChild(empty);
      return;
    }

    items.forEach((entry, index) => {
      const item = document.createElement('li');
      const title = cleanTitle(entry.title);
      if (allowLinks && entry.link) {
        const link = document.createElement('a');
        link.href = entry.link;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = title;
        item.appendChild(link);
      } else {
        const button = document.createElement('button');
        button.className = 'timeline-news-button';
        button.type = 'button';
        button.textContent = title;
        button.addEventListener('click', () => onSelect(entry, index));
        item.appendChild(button);
      }

      const meta = document.createElement('cite');
      const metaText = newsMeta(entry);
      if (metaText) {
        meta.textContent = ` ${metaText}`;
        item.appendChild(document.createElement('br'));
        item.appendChild(meta);
      }
      list.appendChild(item);
    });
  }

  async function fetchNews(location, mode) {
    const params = new URLSearchParams({ mode });
    if (location.query) {
      params.set('q', location.query);
    } else {
      params.set('lat', String(location.lat));
      params.set('lon', String(location.lon));
    }
    const response = await fetch(`${NEWS_ENDPOINT}?${params.toString()}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `News request failed: ${response.status}`);
    return body;
  }

  async function geocodeLocation(query) {
    const params = new URLSearchParams({
      q: query,
      limit: '5'
    });
    const response = await fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Location search failed: ${response.status}`);
    return Array.isArray(body.items) ? body.items : [];
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

  async function summarizeNewsItem(entry, place, mode) {
    const prompt = [
      `Give a brief in-app summary for this ${mode === 'history' ? 'same-date historical/local' : 'recent local'} news item near ${place || 'the selected location'}.`,
      'Use only the fields below. Do not invent extra facts. If the headline is all we have, say that the summary is based on the headline.',
      'Keep it to 2 short sentences.',
      `Title: ${cleanTitle(entry.title)}`,
      `Source: ${entry.source || 'unknown source'}`,
      `Date: ${formatDate(entry.published) || 'unknown date'}`,
      entry.description ? `Source snippet: ${entry.description}` : ''
    ].filter(Boolean).join('\n');

    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-4b-instruct-2507-q5_k_m',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
        temperature: 0.15
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `News brief failed: ${response.status}`);
    return body.reply || (body.choices && body.choices[0] && body.choices[0].message.content) || '';
  }

  function setSummaryText(summary, text, pulsing = false) {
    summary.hidden = false;
    summary.textContent = text;
    summary.classList.toggle('is-pulsing', pulsing);
  }

  function buildSpeakText(state, summary) {
    const summaryText = String(summary.textContent || '').trim();
    if (summaryText && !/preparing|summarizing|unavailable/i.test(summaryText)) return summaryText;
    if (!state.items.length) return '';
    const place = state.place ? `News briefing for ${state.place}. ` : 'News briefing. ';
    const headlines = state.items
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${cleanTitle(item.title)}`)
      .join('. ');
    return `${place}${headlines}`;
  }

  function speakTimelineText(text, speakButton, summary) {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      setSummaryText(summary, 'Load or create an AI briefing before speaking.');
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setSummaryText(summary, 'Speech is not available in this browser.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 1400));
    utterance.rate = 0.95;
    utterance.pitch = 1;
    speakButton.textContent = 'Speaking';
    utterance.onend = () => { speakButton.textContent = 'Speak'; };
    utterance.onerror = () => {
      speakButton.textContent = 'Speak';
      setSummaryText(summary, 'Speech playback was interrupted.');
    };
    window.speechSynthesis.speak(utterance);
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
    const speakButton = $('timelineSpeak');
    const linksInput = $('timelineLinks');
    const locationForm = $('timelineLocationSearch');
    const locationInput = $('timelineLocationInput');
    const locationEcho = $('timelineLocationEcho');
    const summary = $('timelineSummary');
    const showInput = $('showTimeline');

    if (!widget || !list || !placeLabel || !refreshButton || !toggleButton || !opacityInput || !opacityValue || !recentButton || !historyButton || !summarizeButton || !speakButton) return;

    const state = {
      location: null,
      mode: 'recent',
      place: '',
      items: [],
      allowLinks: false
    };

    function describeLocation(match) {
      if (!match) return '';
      const bits = [match.name, match.state, match.country].filter(Boolean);
      return bits.join(', ');
    }

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
      widget.style.opacity = opacity.toFixed(2);
      opacityInput.value = String(numeric);
      opacityValue.textContent = `${numeric}%`;
      localStorage.setItem(opacityKey, String(numeric));
    }

    function setLinksEnabled(enabled) {
      state.allowLinks = Boolean(enabled);
      if (linksInput) linksInput.checked = state.allowLinks;
      localStorage.setItem(linksKey, state.allowLinks ? '1' : '0');
      if (state.location || state.items.length) {
        renderItems(list, state.items, state.allowLinks, showItemBrief);
      }
    }

    function setMode(mode) {
      state.mode = mode;
      recentButton.classList.toggle('is-active', mode === 'recent');
      historyButton.classList.toggle('is-active', mode === 'history');
      summary.hidden = true;
      summary.textContent = '';
      summary.classList.remove('is-pulsing');
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
        state.place = data.place
          || state.location.name
          || `${state.location.lat.toFixed(2)}, ${state.location.lon.toFixed(2)}`;
        state.items = Array.isArray(data.items) ? data.items : [];
        placeLabel.textContent = state.mode === 'history'
          ? `${state.place} / this day`
          : state.place;
        renderItems(list, state.items, state.allowLinks, showItemBrief);
      } catch (error) {
        console.warn('Could not load local timeline.', error);
        placeLabel.textContent = 'news unavailable';
        setLoading(list, error.message || 'News unavailable.');
      }
    }

    async function showItemBrief(entry) {
      setSummaryText(summary, 'Qwen preparing brief...', true);
      try {
        const text = await summarizeNewsItem(entry, state.place, state.mode);
        setSummaryText(summary, text || 'No brief available for this item.');
      } catch (error) {
        const fallback = newsMeta(entry);
        setSummaryText(summary, [
          cleanTitle(entry.title),
          fallback ? `Source: ${fallback}` : '',
          'Qwen brief unavailable.'
        ].filter(Boolean).join('\n'));
      }
    }

    refreshButton.addEventListener('click', loadTimeline);
    toggleButton.addEventListener('click', () => {
      setCollapsed(!widget.classList.contains('is-collapsed'));
    });
    opacityInput.addEventListener('input', () => setOpacity(opacityInput.value));
    if (linksInput) linksInput.addEventListener('change', () => setLinksEnabled(linksInput.checked));
    recentButton.addEventListener('click', () => setMode('recent'));
    historyButton.addEventListener('click', () => setMode('history'));
    if (locationForm && locationInput && locationEcho) {
      locationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = locationInput.value.trim();
        if (!query) {
          locationEcho.textContent = 'Type a location first.';
          return;
        }

        locationEcho.textContent = `Sending: ${query}`;
        setLoading(list, `Searching location: ${query}`);
        try {
          const matches = await geocodeLocation(query);
          if (!matches.length) throw new Error(`Location not found: ${query}`);
          const match = matches[0];
          state.location = {
            lat: Number(match.lat),
            lon: Number(match.lon),
            query,
            name: describeLocation(match)
          };
          state.place = state.location.name || query;
          placeLabel.textContent = state.place;
          locationEcho.textContent = `Using: ${state.place}`;
          loadTimeline();
        } catch (error) {
          placeLabel.textContent = 'location unavailable';
          locationEcho.textContent = error.message || 'Location search failed.';
          setLoading(list, error.message || 'Location search failed.');
        }
      });
    }
    summarizeButton.addEventListener('click', async () => {
      if (!state.items.length) {
        setSummaryText(summary, 'Load timeline items before asking Qwen.');
        return;
      }
      setSummaryText(summary, 'Qwen summarizing source items...', true);
      try {
        setSummaryText(summary, await summarizeItems(state.items, state.place, state.mode));
      } catch (error) {
        setSummaryText(summary, error.message || 'Qwen summary unavailable.');
      }
    });

    speakButton.addEventListener('click', () => {
      speakTimelineText(buildSpeakText(state, summary), speakButton, summary);
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
      if (locationEcho) locationEcho.textContent = 'Using browser location.';
      loadTimeline();
    });

    setVisible(localStorage.getItem(visibilityKey) !== '0');
    setCollapsed(localStorage.getItem(collapsedKey) === '1');
    setOpacity(localStorage.getItem(opacityKey) || opacityInput.value);
    setLinksEnabled(localStorage.getItem(linksKey) === '1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimeline);
  } else {
    initTimeline();
  }
}());
