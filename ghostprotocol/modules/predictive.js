(function (GP) {
  const storageKey = 'ghostprotocol:predictive-recents:v1';
  const enabledKey = 'ghostprotocol:predictive-enabled:v1';
  const maxSuggestions = 3;
  let commands = [];
  let initialized = false;

  function key(value) {
    return GP.commandKey(value);
  }

  function loadRecents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, 8) : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecents(values) {
    localStorage.setItem(storageKey, JSON.stringify(values.slice(0, 8)));
  }

  function enabled() {
    return localStorage.getItem(enabledKey) !== 'off';
  }

  function entryFor(raw) {
    const value = String(raw || '').trim();
    const normalized = key(value);
    if (!normalized) return null;
    return commands.find(entry => entry.keys.includes(normalized)) || null;
  }

  function shouldHide() {
    return !enabled() || !GP.dom.predictiveBar || GP.state.promptHandler ||
      GP.state.controlMode || GP.dom.input.type === 'password';
  }

  function commandScore(entry, normalized, rawLower, index) {
    const recentBoost = loadRecents().includes(entry.command) ? -8 : 0;
    if (!normalized) return recentBoost + index;
    let best = 999;
    for (const phrase of entry.phrases) {
      const phraseKey = key(phrase);
      const phraseLower = phrase.toLowerCase();
      if (phraseKey === normalized) best = Math.min(best, 0);
      else if (phraseKey.startsWith(normalized)) best = Math.min(best, 2 + phraseKey.length - normalized.length);
      else if (phraseLower.startsWith(rawLower)) best = Math.min(best, 4 + phraseLower.length - rawLower.length);
      else if (phraseKey.includes(normalized)) best = Math.min(best, 18 + phraseKey.indexOf(normalized));
    }
    return best + recentBoost + index / 100;
  }

  function applySuggestion(command) {
    GP.dom.input.value = command;
    GP.dom.input.focus({ preventScroll: true });
    const end = command.length;
    if (GP.dom.input.selectionStart !== null) GP.dom.input.setSelectionRange(end, end);
    GP.dom.input.scrollLeft = GP.dom.input.scrollWidth;
    GP.dom.input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: command
    }));
  }

  function hide() {
    if (!GP.dom.predictiveBar) return;
    GP.dom.predictiveBar.hidden = true;
    GP.dom.predictiveBar.replaceChildren();
  }

  function render(matches) {
    if (!GP.dom.predictiveBar) return;
    GP.dom.predictiveBar.replaceChildren();
    if (!matches.length) {
      hide();
      return;
    }
    for (const match of matches.slice(0, maxSuggestions)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'predictive-choice';
      button.textContent = match.command;
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => applySuggestion(match.command));
      GP.dom.predictiveBar.appendChild(button);
    }
    GP.dom.predictiveBar.hidden = false;
  }

  function update() {
    if (shouldHide()) {
      hide();
      return;
    }
    const value = GP.dom.input.value.trim();
    const normalized = key(value);
    const rawLower = value.toLowerCase();
    const recentEntries = loadRecents()
      .map(command => commands.find(entry => entry.command === command))
      .filter(Boolean);
    const source = normalized ? commands : [
      ...recentEntries,
      ...commands.filter(entry => ['help', 'lobby', 'sign-in', 'mydatabase', 'AiTool', 'eva', 'keyboard']
        .map(key).includes(key(entry.command)))
    ];
    const seen = new Set();
    const matches = source
      .map((entry, index) => ({ entry, score: commandScore(entry, normalized, rawLower, index) }))
      .filter(match => match.score < 999)
      .sort((a, b) => a.score - b.score || a.entry.command.localeCompare(b.entry.command))
      .map(match => match.entry)
      .filter(entry => {
        if (seen.has(entry.command)) return false;
        seen.add(entry.command);
        return true;
      });
    render(matches);
  }

  function remember(raw) {
    if (GP.state.promptHandler || GP.state.controlMode || GP.state.chatMode || GP.state.evaMode) return;
    const entry = entryFor(raw);
    if (!entry) return;
    const recents = loadRecents().filter(value => value !== entry.command);
    recents.unshift(entry.command);
    saveRecents(recents);
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
    update();
  }

  function setEnabled(value) {
    localStorage.setItem(enabledKey, value ? 'on' : 'off');
    if (value) update();
    else hide();
    GP.write(`predictive typing: ${value ? 'on' : 'off'}`);
  }

  function status() {
    GP.write(`predictive typing: ${enabled() ? 'on' : 'off'}`);
    GP.commandButton('predictive on', 'predictive on');
    GP.commandButton('predictive off', 'predictive off');
  }

  function init() {
    if (initialized || !GP.dom.input || !GP.dom.predictiveBar) return;
    initialized = true;
    GP.dom.input.addEventListener('input', update);
    GP.dom.input.addEventListener('focus', update);
    GP.dom.input.addEventListener('blur', () => window.setTimeout(update, 120));
    update();
  }

  GP.setPredictiveCommands = setCommands;
  GP.initPredictive = init;
  GP.updatePredictive = update;
  GP.hidePredictive = hide;
  GP.rememberPredictiveEntry = remember;
  GP.setPredictiveEnabled = setEnabled;
  GP.predictiveStatus = status;
})(window.GhostProtocol);
