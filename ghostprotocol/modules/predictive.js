(function (GP) {
  const commandStorageKey = 'ghostprotocol:predictive-recents:v1';
  const phraseStorageKey = 'ghostprotocol:predictive-phrases:v1';
  const enabledKey = 'ghostprotocol:predictive-enabled:v1';
  const textTypes = new Set(['text', 'search', 'email', 'tel', 'url']);
  const commonWords = [
    'about', 'account', 'again', 'analyze', 'audio', 'background', 'board', 'camera',
    'close', 'command', 'database', 'describe', 'details', 'document', 'download',
    'features', 'file', 'folder', 'gallery', 'ghostprotocol', 'image', 'images',
    'located', 'location', 'message', 'mydatabase', 'person', 'picture', 'profile',
    'question', 'reply', 'save', 'scan', 'status', 'terminal', 'thread', 'upload',
    'video', 'voice', 'what', 'where', 'which', 'window'
  ];
  let commands = [];
  let initialized = false;
  let activeField = null;
  let ghost = null;
  let activeSuggestion = null;
  let updateTimer = null;

  function key(value) {
    return GP.commandKey(value);
  }

  function loadList(storageKey, limit = 12) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, limit) : [];
    } catch (_) {
      return [];
    }
  }

  function saveList(storageKey, values, limit = 12) {
    localStorage.setItem(storageKey, JSON.stringify(values.slice(0, limit)));
  }

  function enabled() {
    return localStorage.getItem(enabledKey) !== 'off';
  }

  function editable(field) {
    if (field instanceof HTMLTextAreaElement) return !field.disabled && !field.readOnly;
    return field instanceof HTMLInputElement && textTypes.has(field.type) && !field.disabled && !field.readOnly;
  }

  function prepareField(field) {
    if (!editable(field) || field.dataset.ghostPredictiveReady === 'yes') return;
    field.dataset.ghostPredictiveReady = 'yes';
    field.setAttribute('autocomplete', 'off');
    field.setAttribute('autocorrect', 'off');
    field.setAttribute('autocapitalize', 'none');
    field.setAttribute('spellcheck', 'false');
  }

  function ensureGhost() {
    if (ghost) return ghost;
    ghost = document.createElement('div');
    ghost.className = 'predictive-inline-ghost';
    ghost.hidden = true;
    document.body.appendChild(ghost);
    return ghost;
  }

  function hide() {
    activeSuggestion = null;
    if (ghost) {
      ghost.hidden = true;
      ghost.textContent = '';
    }
    if (GP.dom.predictiveBar) {
      GP.dom.predictiveBar.hidden = true;
      GP.dom.predictiveBar.replaceChildren();
    }
  }

  function entryFor(raw) {
    const value = String(raw || '').trim();
    const normalized = key(value);
    if (!normalized) return null;
    return commands.find(entry => entry.keys.includes(normalized)) || null;
  }

  function commandCandidates(value) {
    const normalized = key(value);
    if (!normalized) return [];
    return commands
      .filter(entry => entry.phrases.some(phrase => key(phrase).startsWith(normalized)))
      .sort((a, b) => a.command.length - b.command.length || a.command.localeCompare(b.command))
      .map(entry => entry.command);
  }

  function wordFragment(text) {
    const match = String(text || '').match(/([A-Za-z][A-Za-z'-]*)$/);
    return match ? match[1] : '';
  }

  function phraseCandidates(value) {
    const lower = value.toLowerCase();
    if (lower.length < 4) return [];
    return loadList(phraseStorageKey, 16)
      .filter(phrase => phrase.toLowerCase().startsWith(lower) && phrase.length > value.length);
  }

  function wordCandidates(fragment) {
    if (!fragment) return [];
    const lower = fragment.toLowerCase();
    const source = [
      ...commonWords,
      ...commands.flatMap(entry => entry.phrases.join(' ').split(/\s+/)),
      ...loadList(phraseStorageKey, 16).join(' ').split(/\s+/)
    ];
    const seen = new Set();
    return source
      .map(word => word.replace(/[^A-Za-z'-]/g, '').toLowerCase())
      .filter(word => word.length > Math.max(2, lower.length) && word.startsWith(lower))
      .filter(word => {
        if (seen.has(word)) return false;
        seen.add(word);
        return true;
      })
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
  }

  function suggestionFor(field) {
    if (!enabled() || !editable(field)) return null;
    if (field.type === 'password') return null;
    if (field === GP.dom.input && (GP.state.promptHandler || GP.state.controlMode)) return null;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    if (start !== end || start !== field.value.length) return null;
    const value = field.value;
    const before = value.slice(0, start);
    const commandField = field === GP.dom.input && !GP.state.chatMode && !GP.state.evaMode;
    if (commandField) {
      const command = commandCandidates(before.trim())[0];
      if (command && command.toLowerCase() !== before.trim().toLowerCase()) {
        const suffix = command.slice(before.trim().length);
        return suffix ? { suffix, replacement: `${before}${suffix}` } : null;
      }
    }
    const phrase = phraseCandidates(before)[0];
    if (phrase) return { suffix: phrase.slice(before.length), replacement: phrase };
    const fragment = wordFragment(before);
    if (fragment.length < 1) return null;
    const word = wordCandidates(fragment)[0];
    if (!word) return null;
    const suffix = word.slice(fragment.length);
    return suffix ? { suffix, replacement: `${before.slice(0, before.length - fragment.length)}${word}` } : null;
  }

  function copyTextStyle(source, target) {
    const style = window.getComputedStyle(source);
    [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textTransform', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom',
      'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
      'borderLeftWidth', 'boxSizing'
    ].forEach(prop => { target.style[prop] = style[prop]; });
    target.style.whiteSpace = source instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
    target.style.overflowWrap = source instanceof HTMLTextAreaElement ? 'break-word' : 'normal';
  }

  function caretPosition(field) {
    const rect = field.getBoundingClientRect();
    const marker = document.createElement('span');
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(field);
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.width = `${rect.width}px`;
    mirror.style.minHeight = `${rect.height}px`;
    mirror.style.overflow = 'hidden';
    copyTextStyle(field, mirror);
    const before = field.value.slice(0, field.selectionEnd ?? field.value.length);
    mirror.textContent = before || '';
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    mirror.remove();
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const left = field instanceof HTMLInputElement
      ? markerRect.left - field.scrollLeft
      : markerRect.left - field.scrollLeft;
    const top = field instanceof HTMLTextAreaElement
      ? markerRect.top - field.scrollTop
      : rect.top + borderTop + (parseFloat(style.paddingTop) || 0);
    return { left: Math.max(rect.left + borderLeft, left), top };
  }

  function render() {
    window.clearTimeout(updateTimer);
    if (!activeField || !activeField.isConnected) {
      hide();
      return;
    }
    prepareField(activeField);
    activeSuggestion = suggestionFor(activeField);
    if (!activeSuggestion) {
      hide();
      return;
    }
    const node = ensureGhost();
    const style = window.getComputedStyle(activeField);
    const rect = activeField.getBoundingClientRect();
    const pos = caretPosition(activeField);
    node.textContent = activeSuggestion.suffix;
    node.style.font = style.font;
    node.style.letterSpacing = style.letterSpacing;
    node.style.lineHeight = style.lineHeight;
    node.style.left = `${pos.left}px`;
    node.style.top = `${pos.top}px`;
    node.style.maxWidth = `${Math.max(0, rect.right - pos.left - 8)}px`;
    node.hidden = false;
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(render, 20);
  }

  function acceptSuggestion() {
    if (!activeField || !activeSuggestion) return false;
    const value = activeSuggestion.replacement;
    activeField.value = value;
    if (activeField.selectionStart !== null) activeField.setSelectionRange(value.length, value.length);
    activeField.scrollLeft = activeField.scrollWidth;
    activeField.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: activeSuggestion.suffix
    }));
    hide();
    return true;
  }

  function rememberPhrase(raw) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (value.length < 8 || value.length > 180) return;
    if (/password|access\s*key|token|secret/i.test(value)) return;
    const list = loadList(phraseStorageKey, 16).filter(item => item.toLowerCase() !== value.toLowerCase());
    list.unshift(value);
    saveList(phraseStorageKey, list, 16);
  }

  function remember(raw) {
    if (GP.state.promptHandler || GP.state.controlMode) return;
    const entry = entryFor(raw);
    if (entry) {
      const recents = loadList(commandStorageKey, 8).filter(value => value !== entry.command);
      recents.unshift(entry.command);
      saveList(commandStorageKey, recents, 8);
      return;
    }
    if (GP.state.chatMode || GP.state.evaMode) rememberPhrase(raw);
  }

  function setCommands(groups) {
    commands = groups.map(group => {
      const phrases = group.filter(Boolean);
      return {
        command: phrases[0],
        phrases,
        keys: phrases.map(key)
      };
    });
    schedule();
  }

  function setEnabled(value) {
    localStorage.setItem(enabledKey, value ? 'on' : 'off');
    if (value) schedule();
    else hide();
    GP.write(`predictive typing: ${value ? 'on' : 'off'}`);
  }

  function status() {
    GP.write(`predictive typing: ${enabled() ? 'on' : 'off'}`);
    GP.write('accept inline completion: Tab or Right Arrow');
    GP.commandButton('predictive on', 'predictive on');
    GP.commandButton('predictive off', 'predictive off');
  }

  function watchFields(root = document) {
    root.querySelectorAll?.('input, textarea').forEach(prepareField);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    hide();
    watchFields();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) watchFields(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', event => {
      if (!editable(event.target)) return;
      activeField = event.target;
      prepareField(activeField);
      schedule();
    });
    document.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (document.activeElement !== activeField) hide();
      }, 60);
    });
    document.addEventListener('input', event => {
      if (event.target === activeField) schedule();
    }, true);
    document.addEventListener('submit', event => {
      const field = event.target instanceof HTMLFormElement
        ? event.target.querySelector('textarea, input[type="text"], input[type="search"]')
        : null;
      if (field && field !== GP.dom.input) rememberPhrase(field.value);
    }, true);
    document.addEventListener('scroll', () => schedule(), true);
    window.addEventListener('resize', schedule);
    document.addEventListener('keydown', event => {
      if (!activeSuggestion || event.defaultPrevented) return;
      if (event.key === 'Tab' || (event.key === 'ArrowRight' &&
        activeField && activeField.selectionEnd === activeField.value.length)) {
        event.preventDefault();
        acceptSuggestion();
      } else if (event.key === 'Escape') {
        hide();
      }
    }, true);
  }

  GP.setPredictiveCommands = setCommands;
  GP.initPredictive = init;
  GP.updatePredictive = schedule;
  GP.hidePredictive = hide;
  GP.rememberPredictiveEntry = remember;
  GP.rememberPredictivePhrase = rememberPhrase;
  GP.acceptPredictiveSuggestion = acceptSuggestion;
  GP.setPredictiveEnabled = setEnabled;
  GP.predictiveStatus = status;
})(window.GhostProtocol);
