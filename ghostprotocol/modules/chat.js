(function (GP) {
  const CHAT_OPENING = [
    'You are speaking through GhostProtocol.',
    'Answer as a concise terminal assistant.',
    'Help with public GhostProtocol features: sign-in, upload, MyDatabase, camera, message board, AiTool, and local image interpretation.',
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
    GP.closeDatabase?.();
    GP.closeLobby?.();
    GP.closeBoard?.(true);
    GP.state.headerHint = undefined;
    GP.state.chatMode = true;
    GP.state.chatMessages = [];
    if (GP.dom.appTitle) GP.dom.appTitle.textContent = 'Ghost Protocol';
    document.querySelector('.chat-session-status')?.remove();
    const sessionStatus = document.createElement('span');
    sessionStatus.className = 'chat-session-status';
    sessionStatus.textContent = ' / AiTool opened';
    GP.dom.connectionState?.insertAdjacentElement('afterend', sessionStatus);
    renderChatHeaderLinks();
    GP.write('');
  }

  function renderChatHeaderLinks() {
    if (!GP.dom.terminalHint) return;
    GP.dom.terminalHint.innerHTML = '';
    GP.dom.terminalHint.classList.add('chat-header-links');
    [
      ['files', 'files'],
      ['voice', 'voice'],
      ['status', 'status'],
      ['close', 'close']
    ].forEach(([label, command]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => GP.run(command));
      GP.dom.terminalHint.appendChild(button);
    });
    GP.renderMailHint?.();
  }

  function exitChat() {
    GP.state.chatMode = false;
    document.querySelector('.chat-session-status')?.remove();
    if (GP.dom.appTitle) GP.dom.appTitle.textContent = 'Ghost Protocol';
    if (GP.dom.terminalHint) {
      GP.dom.terminalHint.classList.remove('chat-header-links');
      GP.dom.terminalHint.textContent = "type 'help' to access terminal";
    }
    GP.renderMailHint?.();
    GP.write('AiTool closed.');
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

  function writeAiReply(reply, target = GP.dom.screen, agentId = 'ghost_host') {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'ai-reply';
    wrap.setAttribute('aria-label', 'Play or stop AI voice reply');
    wrap.dataset.agentId = agentId;

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
      GP.toggleReplyVoice(wrap, reply).catch((error) => GP.write(`voice unavailable: ${error.message}`, 'error'));
    });
    target.appendChild(wrap);
    if (target === GP.dom.screen) GP.autoScroll();
    else target.scrollTop = target.scrollHeight;
    if (GP.state.voiceOutputEnabled && GP.state.voiceAutoplayEnabled) {
      void GP.toggleReplyVoice(wrap, reply);
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
      GP.write(error.message || 'AiTool file upload failed', 'error');
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
      GP.write(error.message || 'AiTool local file failed', 'error');
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
    if (key === 'voice' || key === 'voiceoptions') {
      await GP.showVoiceOptions();
      return;
    }
    if (key === 'voiceon') {
      GP.setVoiceOutput(true);
      return;
    }
    if (key === 'voiceoff') {
      GP.setVoiceOutput(false);
      return;
    }
    if (key === 'autoplayon') {
      GP.setVoiceAutoplay(true);
      return;
    }
    if (key === 'autoplayoff') {
      GP.setVoiceAutoplay(false);
      return;
    }
    if (key === 'autoplay') {
      GP.setVoiceAutoplay(!GP.state.voiceAutoplayEnabled);
      return;
    }
    if (key === 'status' || key === 'aioptions') {
      await GP.showAiStatus();
      return;
    }
    GP.write(`you> ${prompt}`);
    const thinking = animatedStatusLine('ai thinking');
    const account = GP.state.account;
    const session = GP.token();
    const current = () => GP.state.account === account && GP.token() === session && GP.state.chatMode;
    try {
      const messages = [
        { role: 'user', content: CHAT_OPENING },
        ...visibleHistory(),
        { role: 'user', content: prompt }
      ];
      const data = await GP.api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages, app: 'ghostprotocol' })
      });
      thinking.remove();
      if (!current()) return;
      const reply = String(data.reply || data.choices?.[0]?.message?.content || '').trim();
      if (!reply) throw new Error('empty AI reply');
      GP.state.chatMessages.push({ role: 'user', content: prompt });
      GP.state.chatMessages.push({ role: 'assistant', content: reply });
      thinking.remove();
      writeAiReply(reply);
    } catch (error) {
      thinking.remove();
      if (current()) GP.write(`AiTool failed: ${error.message}`, 'error');
    }
  }


  GP.enterChat = enterChat;
  GP.exitChat = exitChat;
  GP.sendChat = sendChat;
  GP.animatedStatusLine = animatedStatusLine;
  GP.writeAiReply = writeAiReply;
})(window.GhostProtocol);

