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
    opacity: 90,
    voiceEnabled: true,
    voiceAutoplay: false
  };

  async function loadWidgetMarkup() {
    if (document.getElementById('chatWidget')) return true;

    const fallbackMarkup = `
<section class="chat-widget is-open" id="chatWidget" aria-label="Qwen chat widget">
  <header class="chat-header">
    <div>
      <strong>Qwen 34B</strong>
      <span id="chatStatus">ready</span>
    </div>
    <div class="chat-actions">
      <button id="chatSettingsToggle" type="button">Settings</button>
      <button id="chatMinimize" type="button">-</button>
    </div>
  </header>

  <form class="chat-settings" id="chatSettings">
    <label><span>API mode</span><select id="apiMode"><option value="relay">Relay server</option><option value="direct">Direct endpoint</option></select></label>
    <label><span>Endpoint</span><input id="apiEndpoint" type="url" autocomplete="off" spellcheck="false"></label>
    <label><span>Model</span><input id="apiModel" type="text" autocomplete="off" spellcheck="false"></label>
    <label><span>Access token / API key</span><input id="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="optional"></label>
    <label><span>Opacity</span><span class="opacity-row"><input id="chatOpacity" type="range" min="35" max="100" step="5"><span id="chatOpacityValue">90%</span></span></label>
    <div class="voice-settings"><label><span>Voice</span><select id="voiceEnabled"><option value="true">Enabled</option><option value="false">Off</option></select></label><label><span>Speak replies</span><select id="voiceAutoplay"><option value="false">Manual</option><option value="true">Auto</option></select></label></div>
    <div class="voice-status-row"><span id="voiceStatus">voice unknown</span><button id="voiceRefresh" type="button">Check voice</button></div>
    <div class="cloud-id">Cloud account <span id="cloudUserLabel">--</span></div>
    <div class="settings-row"><button id="copyCloudKey" type="button">Copy key</button><button id="importCloudKey" type="button">Use key</button></div>
    <div class="settings-row"><button id="saveSettings" type="submit">Save</button><button id="resetSettings" type="button">Reset</button></div>
    <div class="settings-row"><button id="cloudSaveChat" type="button">Cloud save</button><button id="cloudLoadChat" type="button">Refresh cloud</button></div>
    <div class="cloud-list" id="cloudConversationList" aria-live="polite"></div>
    <div class="settings-row"><button id="exportChat" type="button">Save chat</button><button id="importChat" type="button">Load chat</button></div>
    <div class="settings-row"><button id="attachFile" type="button">Upload file</button><button id="clearChat" type="button">Clear chat</button></div>
    <input id="importChatFile" class="hidden-file" type="file" accept="application/json,.json">
    <input id="attachFileInput" class="hidden-file" type="file" accept=".txt,.md,.json,.csv,.log,text/plain,application/json,text/csv">
  </form>

  <div class="chat-log" id="chatLog" aria-live="polite"></div>

  <form class="chat-composer" id="chatForm">
    <textarea id="chatInput" rows="2" placeholder="Ask Qwen..." required></textarea>
    <button id="sendButton" type="submit">Send</button>
  </form>
</section>

<button class="chat-launcher" id="chatLauncher" type="button" aria-label="Open chat">Chat</button>`;

    try {
      const script = document.currentScript;
      const widgetUrl = new URL('widget.html?v=voice1', script ? script.src : window.location.href);
      const response = await fetch(widgetUrl);
      if (!response.ok) throw new Error(`Widget markup failed: ${response.status}`);
      const host = document.body;
      host.insertAdjacentHTML('beforeend', await response.text());
      return true;
    } catch (error) {
      console.warn('Using embedded chat widget markup fallback.', error);
      document.body.insertAdjacentHTML('beforeend', fallbackMarkup);
      return true;
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
  const voiceEnabled = document.getElementById('voiceEnabled');
  const voiceAutoplay = document.getElementById('voiceAutoplay');
  const voiceStatus = document.getElementById('voiceStatus');
  const voiceRefresh = document.getElementById('voiceRefresh');
  const cloudUserLabel = document.getElementById('cloudUserLabel');
  const copyCloudKey = document.getElementById('copyCloudKey');
  const importCloudKey = document.getElementById('importCloudKey');
  const resetSettings = document.getElementById('resetSettings');
  const cloudSaveChat = document.getElementById('cloudSaveChat');
  const cloudLoadChat = document.getElementById('cloudLoadChat');
  const cloudConversationList = document.getElementById('cloudConversationList');
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
    normalized.voiceEnabled = normalized.voiceEnabled === true || normalized.voiceEnabled === 'true';
    normalized.voiceAutoplay = normalized.voiceAutoplay === true || normalized.voiceAutoplay === 'true';
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

  function setCloudUserKey(nextKey) {
    const key = String(nextKey || '').trim();
    if (!/^[a-zA-Z0-9_-]{24,96}$/.test(key)) throw new Error('Cloud key format is invalid.');
    cloudUserKey = key;
    cloudConversationId = '';
    localStorage.setItem(cloudUserStorageKey, cloudUserKey);
    localStorage.removeItem(cloudConversationStorageKey);
    renderSettings();
    renderCloudConversations([]);
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
    if (voiceEnabled) voiceEnabled.value = String(settings.voiceEnabled);
    if (voiceAutoplay) voiceAutoplay.value = String(settings.voiceAutoplay);
    applyOpacity(settings.opacity);
    cloudUserLabel.textContent = `${cloudUserKey.slice(0, 10)}...`;
  }

  function formatCloudDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' });
  }

  function renderCloudConversations(conversations) {
    cloudConversationList.textContent = '';
    if (!conversations.length) {
      const empty = document.createElement('div');
      empty.className = 'cloud-empty';
      empty.textContent = 'No cloud chats saved.';
      cloudConversationList.appendChild(empty);
      return;
    }

    conversations.slice(0, 12).forEach((conversation) => {
      const row = document.createElement('div');
      row.className = 'cloud-chat-row';

      const meta = document.createElement('div');
      meta.className = 'cloud-chat-meta';
      const title = document.createElement('strong');
      title.textContent = conversation.title || 'New chat';
      const date = document.createElement('span');
      date.textContent = formatCloudDate(conversation.updated_at || conversation.created_at);
      meta.append(title, date);

      const actions = document.createElement('div');
      actions.className = 'cloud-chat-actions';
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = 'Load';
      load.addEventListener('click', () => loadCloudConversation(conversation.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Del';
      remove.addEventListener('click', () => deleteCloudConversation(conversation.id));
      actions.append(load, remove);

      row.append(meta, actions);
      cloudConversationList.appendChild(row);
    });
  }

  function applyOpacity(value) {
    const opacity = Math.min(100, Math.max(35, Number(value) || defaultSettings.opacity));
    widget.style.setProperty('--chat-opacity', String(opacity / 100));
    widget.style.opacity = String(opacity / 100);
    chatOpacityValue.textContent = `${opacity}%`;
  }

  function setMessageContent(message, content) {
    const contentNode = message.querySelector('.message-content');
    if (contentNode) {
      contentNode.textContent = content;
    } else {
      message.textContent = content;
    }
  }

  function addMessage(role, content) {
    const message = document.createElement('div');
    message.className = `message ${role}`;
    const contentNode = document.createElement('div');
    contentNode.className = 'message-content';
    contentNode.textContent = content;
    message.appendChild(contentNode);
    if (role === 'assistant') {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const speak = document.createElement('button');
      speak.type = 'button';
      speak.textContent = 'Speak';
      speak.addEventListener('click', () => speakText(contentNode.textContent, speak));
      actions.appendChild(speak);
      message.appendChild(actions);
    }
    chatLog.appendChild(message);
    chatLog.scrollTop = chatLog.scrollHeight;
    return message;
  }

  function voiceApiUrl(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return cleanEndpoint(settings.endpoint).replace(/\/api\/chat$/, cleanPath);
  }

  async function voiceRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const response = await fetch(voiceApiUrl(path), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Voice request failed: ${response.status}`);
    return data;
  }

  async function refreshVoiceStatus() {
    if (!voiceStatus) return;
    if (!settings.voiceEnabled) {
      voiceStatus.textContent = 'voice off';
      return;
    }
    try {
      const data = await voiceRequest('/api/voice/status');
      voiceStatus.textContent = data.votronix_running ? 'voice ready' : 'voice offline';
    } catch (error) {
      voiceStatus.textContent = 'voice offline';
    }
  }

  async function speakText(text, button) {
    const cleanText = String(text || '').trim();
    if (!cleanText || !settings.voiceEnabled) return;
    const previous = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Voice...';
    }
    status.textContent = 'voice';
    try {
      const data = await voiceRequest('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText })
      });
      const audioUrl = `${voiceApiUrl(data.audio_url || '/api/voice/last.wav')}?t=${Date.now()}`;
      const audio = new Audio(audioUrl);
      await audio.play();
      status.textContent = 'ready';
      if (voiceStatus) voiceStatus.textContent = 'voice ready';
    } catch (error) {
      status.textContent = 'voice failed';
      if (voiceStatus) voiceStatus.textContent = 'voice failed';
      addMessage('system', `Voice failed: ${error.message}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previous || 'Speak';
      }
    }
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
      setMessageContent(assistantNode, reply);
      status.textContent = 'ready';
      if (settings.voiceAutoplay) {
        const speakButton = assistantNode.querySelector('.message-actions button');
        speakText(reply, speakButton).catch(() => {});
      }
      autoSaveConversationToCloud();
    } catch (error) {
      setMessageContent(assistantNode, `Connection failed: ${error.message}`);
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

  async function saveConversationToCloud(options = {}) {
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
    if (!options.quiet) status.textContent = 'cloud saved';
    refreshCloudConversations().catch(() => {});
  }

  function autoSaveConversationToCloud() {
    saveConversationToCloud({ quiet: true }).then(() => {
      if (status.textContent === 'ready') status.textContent = 'saved';
      setTimeout(() => {
        if (status.textContent === 'saved') status.textContent = 'ready';
      }, 1200);
    }).catch((error) => {
      console.warn('Cloud autosave failed.', error);
      if (status.textContent === 'ready') status.textContent = 'save failed';
    });
  }

  async function refreshCloudConversations() {
    const data = await cloudRequest('/conversations');
    const conversations = data.conversations || [];
    renderCloudConversations(conversations);
    if (!conversations.length) {
      status.textContent = 'no cloud chats';
    } else {
      status.textContent = 'cloud list ready';
    }
  }

  async function loadCloudConversation(id) {
    const loaded = await cloudRequest(`/conversations/${encodeURIComponent(id)}`);
    cloudConversationId = id;
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

  async function deleteCloudConversation(id) {
    if (!window.confirm('Delete this cloud chat?')) return;
    await cloudRequest(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (cloudConversationId === id) {
      cloudConversationId = '';
      localStorage.removeItem(cloudConversationStorageKey);
    }
    status.textContent = 'cloud deleted';
    await refreshCloudConversations();
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
      opacity: Number(chatOpacity.value),
      voiceEnabled: voiceEnabled ? voiceEnabled.value === 'true' : settings.voiceEnabled,
      voiceAutoplay: voiceAutoplay ? voiceAutoplay.value === 'true' : settings.voiceAutoplay
    });
    status.textContent = 'settings saved';
    setTimeout(() => {
      status.textContent = 'ready';
    }, 1000);
  });

  resetSettings.addEventListener('click', () => {
    saveSettings(defaultSettings);
  });

  copyCloudKey.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cloudUserKey);
      status.textContent = 'cloud key copied';
    } catch (error) {
      window.prompt('Copy this cloud key:', cloudUserKey);
    }
  });

  importCloudKey.addEventListener('click', () => {
    const nextKey = window.prompt('Paste cloud account key:');
    if (!nextKey) return;
    try {
      setCloudUserKey(nextKey);
      status.textContent = 'cloud key set';
      refreshCloudConversations().catch(() => {});
    } catch (error) {
      status.textContent = 'invalid key';
      addMessage('system', error.message);
    }
  });

  cloudSaveChat.addEventListener('click', () => {
    saveConversationToCloud().catch((error) => {
      status.textContent = 'cloud save failed';
      addMessage('system', `Cloud save failed: ${error.message}`);
    });
  });

  cloudLoadChat.addEventListener('click', () => {
    refreshCloudConversations().catch((error) => {
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

  if (voiceRefresh) {
    voiceRefresh.addEventListener('click', () => {
      refreshVoiceStatus();
    });
  }

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
  renderCloudConversations([]);
  refreshVoiceStatus();
  widget.classList.add('is-minimized');
  launcher.classList.add('is-visible');
}());
