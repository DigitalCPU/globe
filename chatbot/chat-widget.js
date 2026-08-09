(async function () {
  const storageKey = 'digitalcpu:qwen-chat-widget:v2';
  const conversationStorageKey = 'digitalcpu:qwen-chat-widget:conversation:v1';
  const cloudUserStorageKey = 'digitalcpu:qwen-chat-widget:cloud-user:v1';
  const cloudConversationStorageKey = 'digitalcpu:qwen-chat-widget:cloud-conversation:v1';
  const stableRelayEndpoint = 'https://globe-qwen-relay.digitalcomputermail.workers.dev/api/chat';
  const cloudApiBase = stableRelayEndpoint.replace('/api/chat', '/api/cloud');
  const systemMessage = {
    role: 'system',
    content: 'You are a helpful assistant embedded in the DigitalCPU globe project.'
  };
  const defaultSettings = {
    mode: 'relay',
    endpoint: stableRelayEndpoint,
    model: 'qwen3-4b-instruct-2507-q5_k_m',
    apiKey: '',
    opacity: 90
  };

  async function loadWidgetMarkup() {
    if (document.getElementById('chatWidget')) return true;

    try {
      const script = document.currentScript;
      const widgetUrl = new URL('widget.html?v=module1', script ? script.src : window.location.href);
      const response = await fetch(widgetUrl);
      if (!response.ok) throw new Error(`Widget markup failed: ${response.status}`);
      document.body.insertAdjacentHTML('beforeend', await response.text());
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  if (!await loadWidgetMarkup()) return;

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
  const cloudUserLabel = document.getElementById('cloudUserLabel');
  const resetSettings = document.getElementById('resetSettings');
  const cloudSaveChat = document.getElementById('cloudSaveChat');
  const cloudLoadChat = document.getElementById('cloudLoadChat');
  const exportChat = document.getElementById('exportChat');
  const importChat = document.getElementById('importChat');
  const importChatFile = document.getElementById('importChatFile');
  const attachFile = document.getElementById('attachFile');
  const attachFileInput = document.getElementById('attachFileInput');
  const clearChat = document.getElementById('clearChat');
  const chatLog = document.getElementById('chatLog');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendButton');
  const status = document.getElementById('chatStatus');

  let settings = loadSettings();
  let cloudUserKey = loadCloudUserKey();
  let cloudConversationId = localStorage.getItem(cloudConversationStorageKey) || '';
  let messages = loadConversation();

  function loadSettings() {
    try {
      return normalizeSettings({ ...defaultSettings, ...JSON.parse(localStorage.getItem(storageKey) || '{}') });
    } catch (error) {
      return { ...defaultSettings };
    }
  }

  function cleanEndpoint(value) {
    return String(value || '')
      .trim()
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/\s*`\s*$/, '')
      .replace(/\s+/g, '');
  }

  function normalizeSettings(nextSettings) {
    const normalized = { ...defaultSettings, ...nextSettings };
    normalized.endpoint = cleanEndpoint(normalized.endpoint);
    if (
      !normalized.endpoint
      || normalized.endpoint.includes('127.0.0.1')
      || normalized.endpoint.includes('localhost')
      || !/^https:\/\/.+\/api\/chat$/.test(normalized.endpoint)
    ) {
      normalized.endpoint = stableRelayEndpoint;
      normalized.apiKey = '';
    }
    return normalized;
  }

  function saveSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    localStorage.setItem(storageKey, JSON.stringify(settings));
    renderSettings();
  }

  function loadConversation() {
    try {
      const saved = JSON.parse(localStorage.getItem(conversationStorageKey) || 'null');
      if (!Array.isArray(saved)) return [{ ...systemMessage }];
      const safeMessages = saved
        .filter((message) => message && ['system', 'user', 'assistant'].includes(message.role))
        .map((message) => ({
          role: message.role,
          content: String(message.content || '').slice(0, 200000)
        }));
      return safeMessages.length ? safeMessages : [{ ...systemMessage }];
    } catch (error) {
      return [{ ...systemMessage }];
    }
  }

  function saveConversation() {
    localStorage.setItem(conversationStorageKey, JSON.stringify(messages));
  }

  function randomBase64Url(bytes = 24) {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return btoa(String.fromCharCode(...values))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function loadCloudUserKey() {
    let key = localStorage.getItem(cloudUserStorageKey) || '';
    if (!/^[a-zA-Z0-9_-]{24,96}$/.test(key)) {
      key = `user_${randomBase64Url(24)}`;
      localStorage.setItem(cloudUserStorageKey, key);
    }
    return key;
  }

  function cloudHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Globe-User': cloudUserKey
    };
  }

  async function cloudRequest(path, options = {}) {
    const response = await fetch(`${cloudApiBase}${path}`, {
      ...options,
      headers: {
        ...cloudHeaders(),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Cloud request failed: ${response.status}`);
    return data;
  }

  function renderConversation() {
    chatLog.textContent = '';
    const visibleMessages = messages.filter((message) => message.role !== 'system');
    if (!visibleMessages.length) {
      addMessage('system', 'Chat history saves on this device. Use Save chat to export a copy.');
      return;
    }
    visibleMessages.forEach((message) => addMessage(message.role, message.content));
  }

  function renderSettings() {
    apiMode.value = settings.mode;
    apiEndpoint.value = settings.endpoint;
    apiModel.value = settings.model;
    apiKey.value = settings.apiKey;
    chatOpacity.value = String(settings.opacity);
    applyOpacity(settings.opacity);
    cloudUserLabel.textContent = cloudUserKey.slice(0, 10);
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

  function pushMessage(role, content) {
    messages.push({ role, content });
    saveConversation();
    return addMessage(role, content);
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
    pushMessage('user', userText);
    const assistantNode = addMessage('assistant', 'Thinking...');
    status.textContent = 'thinking';
    sendButton.disabled = true;

    try {
      const reply = await requestCompletion();
      messages.push({ role: 'assistant', content: reply });
      saveConversation();
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

  function chatExportPayload() {
    return {
      app: 'DigitalCPU globe Qwen chat',
      exported_at: new Date().toISOString(),
      endpoint: settings.endpoint,
      model: settings.model,
      messages
    };
  }

  async function saveConversationToCloud() {
    const title = messages.find((message) => message.role === 'user')?.content
      ?.replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'New chat';
    const data = await cloudRequest('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        id: cloudConversationId || undefined,
        title,
        messages
      })
    });
    cloudConversationId = data.conversation?.id || cloudConversationId;
    if (cloudConversationId) localStorage.setItem(cloudConversationStorageKey, cloudConversationId);
    status.textContent = 'cloud saved';
  }

  async function loadConversationFromCloud() {
    const data = await cloudRequest('/conversations');
    const conversations = data.conversations || [];
    if (!conversations.length) {
      status.textContent = 'no cloud chats';
      addMessage('system', 'No cloud conversations saved for this Cloud ID yet.');
      return;
    }

    const menu = conversations
      .slice(0, 10)
      .map((conversation, index) => `${index + 1}. ${conversation.title}`)
      .join('\n');
    const choice = window.prompt(`Choose a cloud chat:\n${menu}`, '1');
    const selected = conversations[Number(choice) - 1];
    if (!selected) return;

    const loaded = await cloudRequest(`/conversations/${encodeURIComponent(selected.id)}`);
    cloudConversationId = selected.id;
    localStorage.setItem(cloudConversationStorageKey, cloudConversationId);
    messages = (loaded.messages || []).map((message) => ({
      role: message.role,
      content: String(message.content || '')
    }));
    if (!messages.some((message) => message.role === 'system')) messages.unshift({ ...systemMessage });
    saveConversation();
    renderConversation();
    status.textContent = 'cloud loaded';
  }

  async function exportConversation() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `digitalcpu-qwen-chat-${stamp}.json`;
    const body = JSON.stringify(chatExportPayload(), null, 2);
    const blob = new Blob([body], { type: 'application/json' });
    const file = new File([blob], fileName, { type: 'application/json' });

    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          files: [file],
          title: 'DigitalCPU Qwen chat',
          text: 'Saved Qwen conversation'
        });
        status.textContent = 'chat shared';
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'chat saved';
  }

  async function importConversation(file) {
    if (!file) return;
    const data = JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : data.messages;
    if (!Array.isArray(imported)) throw new Error('No messages found in chat file.');
    messages = imported
      .filter((message) => message && ['system', 'user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: String(message.content || '') }));
    if (!messages.some((message) => message.role === 'system')) messages.unshift({ ...systemMessage });
    saveConversation();
    renderConversation();
    status.textContent = 'chat loaded';
  }

  async function attachTextFile(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error('File is larger than 1 MB.');
    const text = await file.text();
    const prompt = [
      `Uploaded file: ${file.name}`,
      `Type: ${file.type || 'unknown'}`,
      '',
      text.slice(0, 60000)
    ].join('\n');
    cloudRequest('/files', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: cloudConversationId || null,
        name: file.name,
        type: file.type || 'text/plain',
        content: text
      })
    }).then(() => {
      status.textContent = 'file cloud saved';
    }).catch((error) => {
      addMessage('system', `Cloud file save failed: ${error.message}`);
    });
    pushMessage('user', prompt);
    status.textContent = 'file added';
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
      endpoint: cleanEndpoint(apiEndpoint.value),
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

  cloudSaveChat.addEventListener('click', () => {
    saveConversationToCloud().catch((error) => {
      status.textContent = 'cloud save failed';
      addMessage('system', `Cloud save failed: ${error.message}`);
    });
  });

  cloudLoadChat.addEventListener('click', () => {
    loadConversationFromCloud().catch((error) => {
      status.textContent = 'cloud load failed';
      addMessage('system', `Cloud load failed: ${error.message}`);
    });
  });

  exportChat.addEventListener('click', () => {
    exportConversation().catch((error) => {
      status.textContent = 'save failed';
      addMessage('system', `Save failed: ${error.message}`);
    });
  });

  importChat.addEventListener('click', () => {
    importChatFile.click();
  });

  importChatFile.addEventListener('change', () => {
    importConversation(importChatFile.files[0]).catch((error) => {
      status.textContent = 'load failed';
      addMessage('system', `Load failed: ${error.message}`);
    }).finally(() => {
      importChatFile.value = '';
    });
  });

  attachFile.addEventListener('click', () => {
    attachFileInput.click();
  });

  attachFileInput.addEventListener('change', () => {
    attachTextFile(attachFileInput.files[0]).catch((error) => {
      status.textContent = 'upload failed';
      addMessage('system', `Upload failed: ${error.message}`);
    }).finally(() => {
      attachFileInput.value = '';
    });
  });

  clearChat.addEventListener('click', () => {
    if (!window.confirm('Clear this chat on this device?')) return;
    messages = [{ ...systemMessage }];
    saveConversation();
    renderConversation();
    status.textContent = 'chat cleared';
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
  renderConversation();
}());
