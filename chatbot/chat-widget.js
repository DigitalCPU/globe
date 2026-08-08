(function () {
  const storageKey = 'digitalcpu:qwen-chat-widget:v1';
  const defaultSettings = {
    mode: 'relay',
    endpoint: 'http://127.0.0.1:8091/api/chat',
    model: 'qwen3-4b-instruct-2507-q5_k_m',
    apiKey: '',
    opacity: 90
  };

  const widget = document.getElementById('chatWidget');
  const launcher = document.getElementById('chatLauncher');
  const minimizeButton = document.getElementById('chatMinimize');
  const settingsToggle = document.getElementById('chatSettingsToggle');
  const settingsForm = document.getElementById('chatSettings');
  const apiMode = document.getElementById('apiMode');
  const apiEndpoint = document.getElementById('apiEndpoint');
  const apiModel = document.getElementById('apiModel');
  const apiKey = document.getElementById('apiKey');
  const chatOpacity = document.getElementById('chatOpacity');
  const chatOpacityValue = document.getElementById('chatOpacityValue');
  const resetSettings = document.getElementById('resetSettings');
  const chatLog = document.getElementById('chatLog');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendButton');
  const status = document.getElementById('chatStatus');

  let settings = loadSettings();
  let messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant embedded in the DigitalCPU globe project.'
    }
  ];

  function loadSettings() {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
    } catch (error) {
      return { ...defaultSettings };
    }
  }

  function saveSettings(nextSettings) {
    settings = { ...defaultSettings, ...nextSettings };
    localStorage.setItem(storageKey, JSON.stringify(settings));
    renderSettings();
  }

  function renderSettings() {
    apiMode.value = settings.mode;
    apiEndpoint.value = settings.endpoint;
    apiModel.value = settings.model;
    apiKey.value = settings.apiKey;
    chatOpacity.value = String(settings.opacity);
    applyOpacity(settings.opacity);
  }

  function applyOpacity(value) {
    const opacity = Math.min(100, Math.max(35, Number(value) || defaultSettings.opacity));
    widget.style.setProperty('--chat-opacity', String(opacity / 100));
    widget.style.opacity = String(opacity / 100);
    chatOpacityValue.textContent = `${opacity}%`;
  }

  function addMessage(role, content) {
    const message = document.createElement('div');
    message.className = `message ${role}`;
    message.textContent = content;
    chatLog.appendChild(message);
    chatLog.scrollTop = chatLog.scrollHeight;
    return message;
  }

  function buildPayload() {
    return {
      model: settings.model,
      messages,
      temperature: 0.7,
      stream: false
    };
  }

  async function requestCompletion() {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildPayload())
    });

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);

    const data = await response.json();
    return data.reply
      || data.choices?.[0]?.message?.content
      || data.choices?.[0]?.text
      || 'No response text returned.';
  }

  async function sendMessage(userText) {
    messages.push({ role: 'user', content: userText });
    addMessage('user', userText);
    const assistantNode = addMessage('assistant', 'Thinking...');
    status.textContent = 'thinking';
    sendButton.disabled = true;

    try {
      const reply = await requestCompletion();
      messages.push({ role: 'assistant', content: reply });
      assistantNode.textContent = reply;
      status.textContent = 'ready';
    } catch (error) {
      assistantNode.textContent = `Connection failed: ${error.message}`;
      status.textContent = 'offline';
    } finally {
      sendButton.disabled = false;
      chatInput.focus();
    }
  }

  settingsToggle.addEventListener('click', () => {
    settingsForm.classList.toggle('is-visible');
  });

  minimizeButton.addEventListener('click', () => {
    widget.classList.add('is-minimized');
    launcher.classList.add('is-visible');
  });

  launcher.addEventListener('click', () => {
    widget.classList.remove('is-minimized');
    launcher.classList.remove('is-visible');
  });

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings({
      mode: apiMode.value,
      endpoint: apiEndpoint.value.trim(),
      model: apiModel.value.trim(),
      apiKey: apiKey.value.trim(),
      opacity: Number(chatOpacity.value)
    });
    status.textContent = 'settings saved';
    setTimeout(() => {
      status.textContent = 'ready';
    }, 1000);
  });

  resetSettings.addEventListener('click', () => {
    saveSettings(defaultSettings);
  });

  chatOpacity.addEventListener('input', () => {
    applyOpacity(chatOpacity.value);
  });

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const userText = chatInput.value.trim();
    if (!userText) return;

    chatInput.value = '';
    sendMessage(userText);
  });

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });

  renderSettings();
  addMessage('system', 'Configure a direct OpenAI-compatible endpoint, or run the included relay server.');
}());
