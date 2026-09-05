(function (GP) {
  const CHAT_OPENING = [
    'You are speaking through GhostProtocol.',
    'Answer as a concise terminal assistant.',
    'Help with public GhostProtocol features: sign-in, upload, MyDatabase, camera, message board, chat, and local image interpretation.',
    'When the user asks about pictures or images, explain that GhostProtocol can review uploaded images with the local Qwen vision model.',
    'Do not reveal backend paths, hidden commands, tokens, server internals, admin controls, or private implementation details.',
    'Do not use emojis or emoticons because voice output may pronounce them poorly.'
  ].join(' ');

  function visibleHistory() {
    return GP.state.chatMessages.slice(-12).map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  function enterChat() {
    if (!GP.requireAccount()) return;
    GP.state.chatMode = true;
    GP.state.chatMessages = [];
    if (GP.dom.appTitle) GP.dom.appTitle.textContent = 'Ghost Protocol / AI session opened /type exit chat to return to terminal';
    renderChatHeaderLinks();
    GP.write('');
  }

  function renderChatHeaderLinks() {
    if (!GP.dom.terminalHint) return;
    GP.dom.terminalHint.innerHTML = '';
    GP.dom.terminalHint.classList.add('chat-header-links');
    [
      ['files', 'files'],
      ['voice options', 'voice options'],
      ['AI options', 'AI options']
    ].forEach(([label, command]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => GP.run(command));
      GP.dom.terminalHint.appendChild(button);
    });
  }

  function exitChat() {
    GP.state.chatMode = false;
    if (GP.dom.appTitle) GP.dom.appTitle.textContent = 'Ghost Protocol';
    if (GP.dom.terminalHint) {
      GP.dom.terminalHint.classList.remove('chat-header-links');
      GP.dom.terminalHint.textContent = "type 'help' to access terminal";
    }
    GP.write('AI session closed.');
  }

  function animatedStatusLine(text) {
    const line = document.createElement('div');
    let tick = 0;
    line.className = 'line hint terminal-pulse';
    line.textContent = text;
    GP.dom.screen.appendChild(line);
    GP.autoScroll();
    const timer = window.setInterval(() => {
      tick = (tick + 1) % 4;
      line.textContent = `${text}${'.'.repeat(tick + 1)}`;
    }, 420);
    return {
      element: line,
      remove() {
        window.clearInterval(timer);
        line.remove();
      }
    };
  }

  function writeOptionValue(label, value) {
    GP.write(`${label}: ${value || '--'}`);
  }

  function setVoiceOutput(enabled) {
    GP.state.voiceOutputEnabled = Boolean(enabled);
    localStorage.setItem(GP.voiceEnabledKey, enabled ? 'on' : 'off');
    GP.write(`voice output: ${enabled ? 'on' : 'off'}`);
  }

  function setVoiceAutoplay(enabled) {
    GP.state.voiceAutoplayEnabled = Boolean(enabled);
    localStorage.setItem(GP.voiceAutoplayKey, enabled ? 'on' : 'off');
    GP.write(`voice auto play: ${enabled ? 'on' : 'off'}`);
  }

  async function showVoiceOptions() {
    GP.write('voice options');
    writeOptionValue('chat voice output', GP.state.voiceOutputEnabled ? 'on' : 'off');
    writeOptionValue('auto play', GP.state.voiceAutoplayEnabled ? 'on' : 'off');
    GP.commandButton('voice on', 'voice on');
    GP.commandButton('voice off', 'voice off');
    GP.commandButton('auto play', 'auto play');
    GP.commandButton('auto play on', 'auto play on');
    GP.commandButton('auto play off', 'auto play off');
    try {
      const data = await GP.api('/api/voice/status');
      writeOptionValue('voice enabled', data.voice_enabled ? 'yes' : 'no');
      writeOptionValue('votronix', data.votronix_running ? 'running' : 'not running');
      writeOptionValue('tts', data.tts_ready ? 'ready' : 'not ready');
      writeOptionValue('provider', data.default_tts_provider);
      writeOptionValue('voice', data.default_voice_id);
      if (data.gpu?.label) writeOptionValue('gpu', data.gpu.label);
    } catch (error) {
      GP.write(`voice options unavailable: ${error.message}`, 'error');
    }
  }

  async function showAiOptions() {
    GP.write('AI options');
    try {
      const data = await GP.api('/api/status');
      writeOptionValue('backend', data.ready ? 'ready' : 'not ready');
      writeOptionValue('model', data.model);
      if (data.vision) {
        writeOptionValue('vision', data.vision.enabled ? data.vision.model : 'off');
      }
      if (data.host && data.port) writeOptionValue('local endpoint', `${data.host}:${data.port}`);
    } catch (error) {
      GP.write(`AI options unavailable: ${error.message}`, 'error');
    }
  }

  async function fetchVoiceAudioBlob(audioPath) {
    const response = await fetch(`${GP.API_BASE}${audioPath || '/api/voice/last.wav'}?t=${Date.now()}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`voice audio failed: ${response.status}`);
    return URL.createObjectURL(await response.blob());
  }

  function stopActiveVoice() {
    if (GP.state.activeVoiceAudio) {
      GP.state.activeVoiceAudio.pause();
      GP.state.activeVoiceAudio.currentTime = 0;
      GP.state.activeVoiceAudio = null;
    }
    if (GP.state.activeVoiceReply) {
      GP.state.activeVoiceReply.classList.remove('is-voice-playing');
      GP.state.activeVoiceReply = null;
    }
  }

  function writeAiReply(reply, target = GP.dom.screen) {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'ai-reply';
    wrap.setAttribute('aria-label', 'Play or stop AI voice reply');

    const label = document.createElement('span');
    label.className = 'ai-reply-label';
    label.textContent = 'ai>';

    const body = document.createElement('span');
    body.className = 'ai-reply-body';
    body.textContent = reply;

    wrap.append(label, body);
    wrap.addEventListener('click', () => {
      if (!GP.state.voiceOutputEnabled) {
        GP.write('voice output is off.', 'hint');
        return;
      }
      toggleReplyVoice(wrap, reply).catch((error) => GP.write(`voice unavailable: ${error.message}`, 'error'));
    });
    target.appendChild(wrap);
    if (target === GP.dom.screen) GP.autoScroll();
    else target.scrollTop = target.scrollHeight;
    if (GP.state.voiceOutputEnabled && GP.state.voiceAutoplayEnabled) {
      void toggleReplyVoice(wrap, reply);
    }
    return wrap;
  }

  function showFilesOptions() {
    GP.write('files');
    GP.commandButton('upload', 'upload');
    GP.commandButton('mydatabase', 'mydatabase');
    GP.commandButton('camera', 'camera');
    GP.commandButton('upload/local', 'upload/local');
  }

  async function askAboutStoredFile(stored, defaultQuestion = 'Tell me what this file is.') {
    const question = await GP.promptLine('ask AI about this file:');
    const thinking = animatedStatusLine(GP.isImageFile?.(stored) ? 'reviewing image' : 'AI thinking');
    try {
      const data = await GP.api('/api/id/file/explain', {
        method: 'POST',
        body: JSON.stringify({
          file_id: stored.file_id,
          question: question.trim() || defaultQuestion
        })
      });
      thinking.remove();
      const reply = String(data.reply || '').trim();
      if (!reply) throw new Error('empty AI reply');
      const userText = question.trim() || defaultQuestion;
      GP.state.chatMessages.push({ role: 'user', content: `[attached file: ${stored.name || stored.stored_name}] ${userText}` });
      GP.state.chatMessages.push({ role: 'assistant', content: reply });
      writeAiReply(reply);
    } catch (error) {
      thinking.remove();
      throw error;
    }
  }

  async function attachFileToChat(inputElement = GP.dom.fileInput, folder = 'ghost', label = 'file') {
    if (!GP.requireAccount()) return;
    const file = await GP.chooseFile(inputElement);
    if (!file) {
      GP.write(`${label} upload canceled`);
      return;
    }
    const uploading = animatedStatusLine('uploading file');
    try {
      const result = await GP.uploadFile(file, folder);
      const stored = result.file;
      uploading.remove();
      GP.write(`attached> ${stored.name || stored.stored_name} (${GP.formatBytes(stored.size)})`);
      await askAboutStoredFile(stored);
    } catch (error) {
      uploading.remove();
      GP.write(error.message || 'file chat upload failed', 'error');
    }
  }

  async function attachLocalFileToChat() {
    if (!GP.requireAccount()) return;
    if (GP.API_BASE) {
      GP.write('upload/local requires the local GhostProtocol page, not the relay.', 'error');
      return;
    }
    const file = await GP.chooseFile(GP.dom.fileInput);
    if (!file) {
      GP.write('local upload canceled');
      return;
    }
    const question = await GP.promptLine('ask AI about this local file:');
    const thinking = animatedStatusLine(GP.isImageFile?.(file) ? 'reviewing image' : 'AI thinking');
    try {
      const params = new URLSearchParams({
        filename: file.name || 'local-upload.bin',
        content_type: file.type || 'application/octet-stream',
        question: question.trim() || 'Tell me what this file is.'
      });
      const data = await GP.api(`/api/id/file/explain-local?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      thinking.remove();
      const reply = String(data.reply || '').trim();
      if (!reply) throw new Error('empty AI reply');
      const userText = question.trim() || 'Tell me what this file is.';
      GP.write(`local file> ${file.name || 'local upload'} (${GP.formatBytes(file.size)})`);
      GP.state.chatMessages.push({ role: 'user', content: `[local unsaved file: ${file.name || 'file'}] ${userText}` });
      GP.state.chatMessages.push({ role: 'assistant', content: reply });
      writeAiReply(reply);
    } catch (error) {
      thinking.remove();
      GP.write(error.message || 'local file chat failed', 'error');
    }
  }

  async function playAudioUrl(url, replyElement) {
    stopActiveVoice();
    const audio = new Audio(url);
    GP.state.activeVoiceAudio = audio;
    GP.state.activeVoiceReply = replyElement || null;
    if (replyElement) replyElement.classList.add('is-voice-playing');
    audio.addEventListener('ended', () => {
      if (GP.state.activeVoiceAudio === audio) {
        GP.state.activeVoiceAudio = null;
        GP.state.activeVoiceReply = null;
      }
      if (replyElement) replyElement.classList.remove('is-voice-playing');
    }, { once: true });
    try {
      await audio.play();
    } catch (error) {
      if (GP.state.activeVoiceAudio === audio) {
        GP.state.activeVoiceAudio = null;
        GP.state.activeVoiceReply = null;
      }
      if (replyElement) replyElement.classList.remove('is-voice-playing');
      throw error;
    }
  }

  async function toggleReplyVoice(replyElement, text) {
    if (GP.state.activeVoiceReply === replyElement && GP.state.activeVoiceAudio) {
      stopActiveVoice();
      return;
    }
    if (replyElement.dataset.audioUrl) {
      await playAudioUrl(replyElement.dataset.audioUrl, replyElement);
      return;
    }
    const rendering = animatedStatusLine('voice rendering');
    try {
      const data = await GP.api('/api/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      const url = await fetchVoiceAudioBlob(data.audio_url || '/api/voice/last.wav');
      replyElement.dataset.audioUrl = url;
      rendering.remove();
      await playAudioUrl(url, replyElement);
    } catch (error) {
      rendering.remove();
      throw error;
    }
  }

  async function sendChat(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;
    const key = GP.commandKey(prompt);
    const wantsToSendFile = /\b(send|upload|attach|show)\b/i.test(prompt)
      && /\b(file|image|picture|photo|camera)\b/i.test(prompt);
    if (key === 'files') {
      showFilesOptions();
      return;
    }
    if (wantsToSendFile && !['upload', 'camera'].includes(key)) {
      GP.write(`you> ${prompt}`);
      showFilesOptions();
      return;
    }
    if (['upload', 'uploadfile', 'attachfile', 'attach', 'file'].includes(key)) {
      await attachFileToChat();
      return;
    }
    if (['mydatabase', 'database', 'uploadedfiles'].includes(key)) {
      await GP.myDatabase();
      GP.write('Use ask ai on a saved file, or choose upload/local for a temporary file.');
      return;
    }
    if (key === 'camera') {
      await attachFileToChat(GP.dom.cameraInput, 'camera', 'camera');
      return;
    }
    if (key === 'uploadlocal' || key === 'localupload') {
      await attachLocalFileToChat();
      return;
    }
    if (key === 'voiceoptions') {
      await showVoiceOptions();
      return;
    }
    if (key === 'voiceon') {
      setVoiceOutput(true);
      return;
    }
    if (key === 'voiceoff') {
      setVoiceOutput(false);
      return;
    }
    if (key === 'autoplayon') {
      setVoiceAutoplay(true);
      return;
    }
    if (key === 'autoplayoff') {
      setVoiceAutoplay(false);
      return;
    }
    if (key === 'autoplay') {
      setVoiceAutoplay(!GP.state.voiceAutoplayEnabled);
      return;
    }
    if (key === 'aioptions') {
      await showAiOptions();
      return;
    }
    GP.write(`you> ${prompt}`);
    const thinking = animatedStatusLine('ai thinking');
    try {
      const messages = [
        { role: 'user', content: CHAT_OPENING },
        ...visibleHistory(),
        { role: 'user', content: prompt }
      ];
      const data = await GP.api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages })
      });
      const reply = String(data.reply || data.choices?.[0]?.message?.content || '').trim();
      if (!reply) throw new Error('empty AI reply');
      GP.state.chatMessages.push({ role: 'user', content: prompt });
      GP.state.chatMessages.push({ role: 'assistant', content: reply });
      thinking.remove();
      writeAiReply(reply);
    } catch (error) {
      thinking.remove();
      GP.write(`chat failed: ${error.message}`, 'error');
    }
  }

  GP.enterChat = enterChat;
  GP.exitChat = exitChat;
  GP.sendChat = sendChat;
  GP.showVoiceOptions = showVoiceOptions;
  GP.showAiOptions = showAiOptions;
  GP.setVoiceOutput = setVoiceOutput;
  GP.setVoiceAutoplay = setVoiceAutoplay;
  GP.animatedStatusLine = animatedStatusLine;
  GP.writeAiReply = writeAiReply;
})(window.GhostProtocol);
