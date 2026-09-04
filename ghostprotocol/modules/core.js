(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const API_BASE = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '' : RELAY_BASE;
  const sessionKey = 'ghostprotocol:session:v1';
  const deviceKey = 'ghostprotocol:device-id:v1';
  const voiceEnabledKey = 'ghostprotocol:voice-enabled:v1';
  const voiceAutoplayKey = 'ghostprotocol:voice-autoplay:v1';

  const dom = {
    screen: document.getElementById('screen'),
    appTitle: document.getElementById('appTitle'),
    terminalHint: document.getElementById('terminalHint'),
    form: document.getElementById('commandForm'),
    input: document.getElementById('commandInput'),
    fileInput: document.getElementById('fileInput'),
    cameraInput: document.getElementById('cameraInput'),
    connectionState: document.getElementById('connectionState'),
    sessionState: document.getElementById('sessionState'),
    windowMinimize: document.getElementById('windowMinimize'),
    windowRestore: document.getElementById('windowRestore'),
    windowFullscreen: document.getElementById('windowFullscreen'),
    windowClose: document.getElementById('windowClose')
  };

  const state = {
    account: null,
    files: [],
    posts: [],
    fullscreenAttempted: false,
    promptHandler: null,
    chatMode: false,
    chatMessages: [],
    activeVoiceAudio: null,
    activeVoiceReply: null,
    voiceOutputEnabled: localStorage.getItem(voiceEnabledKey) !== 'off',
    voiceAutoplayEnabled: localStorage.getItem(voiceAutoplayKey) === 'on',
    controlMode: false,
    boardOpen: false,
    boardElement: null
  };

  function write(text = '', className = '') {
    const line = document.createElement('div');
    line.className = `line ${className}`.trim();
    line.textContent = text;
    dom.screen.appendChild(line);
    autoScroll();
  }

  function clear() {
    dom.screen.innerHTML = '';
  }

  function autoScroll() {
    dom.screen.scrollTop = dom.screen.scrollHeight;
  }

  function commandKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function deviceId() {
    let value = localStorage.getItem(deviceKey);
    if (!value) {
      const random = crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      value = `ghost-${random}`;
      localStorage.setItem(deviceKey, value);
    }
    return value;
  }

  async function enterFullscreen() {
    if (document.fullscreenElement) return true;
    const target = document.documentElement;
    if (!target.requestFullscreen) return false;
    try {
      await target.requestFullscreen({ navigationUI: 'hide' });
      return true;
    } catch (error) {
      return false;
    }
  }

  function activateImmersion() {
    if (state.fullscreenAttempted || document.fullscreenElement) return;
    state.fullscreenAttempted = true;
    void enterFullscreen();
  }

  function token() {
    return localStorage.getItem(sessionKey) || '';
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const auth = token();
    if (auth) headers['X-ID-Session'] = auth;
    headers['X-Device-ID'] = deviceId();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const type = response.headers.get('Content-Type') || '';
    const payload = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.error : payload;
      throw new Error(message || `Request failed: ${response.status}`);
    }
    return payload;
  }

  function commandButton(label, command) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => window.GhostProtocol.run(command));
    dom.screen.appendChild(button);
    autoScroll();
  }

  function inlineButton(label, handler) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function deleteButton(label, handler) {
    const button = inlineButton(label, handler);
    button.classList.add('board-delete-item');
    return button;
  }

  function requireAccount() {
    if (state.account) return true;
    write('No active session. Use sign-in.', 'error');
    return false;
  }

  function isOwner() {
    return String(state.account?.role || '').toLowerCase() === 'owner';
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function updateSession() {
    if (!state.account) {
      dom.sessionState.textContent = 'guest';
      return;
    }
    dom.sessionState.textContent = state.account.display_name || state.account.username;
  }

  function promptLine(question, type = 'text') {
    return new Promise((resolve) => {
      write(question);
      const oldType = dom.input.type;
      dom.input.type = type;
      dom.input.value = '';
      dom.input.focus();
      state.promptHandler = () => {
        const value = dom.input.value;
        dom.input.value = '';
        dom.input.type = oldType;
        state.promptHandler = null;
        resolve(value);
      };
    });
  }

  window.GhostProtocol = {
    API_BASE,
    sessionKey,
    voiceEnabledKey,
    voiceAutoplayKey,
    dom,
    state,
    write,
    clear,
    autoScroll,
    commandKey,
    deviceId,
    enterFullscreen,
    activateImmersion,
    token,
    api,
    commandButton,
    inlineButton,
    deleteButton,
    requireAccount,
    isOwner,
    formatBytes,
    updateSession,
    promptLine
  };
})();
