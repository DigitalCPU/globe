(function (GP) {
  const Files = GP.Files = GP.Files || {};
  async function viewFile(file, row) {
    if (!Files.isImageFile(file)) {
      GP.write('preview is available for images. use download for this file.', 'error');
      return;
    }
    const existing = row.querySelector('.file-preview');
    if (existing) {
      existing.remove();
      return;
    }
    const reviewing = GP.animatedStatusLine ? GP.animatedStatusLine('reviewing image') : null;
    try {
      const response = await fetch(`${GP.API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(file.file_id)}`, {
        headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
      });
      if (!response.ok) throw new Error(`preview failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const wrap = document.createElement('div');
      wrap.className = 'file-preview';
      const image = document.createElement('img');
      image.src = url;
      image.alt = file.name || file.stored_name || 'image preview';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      wrap.appendChild(image);
      row.appendChild(wrap);
      if (reviewing) reviewing.remove();
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      GP.write(error.message || 'preview failed', 'error');
    }
  }

  async function loadFxImage(file, container, className = '') {
    const response = await fetch(`${GP.API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`preview failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const image = document.createElement('img');
    image.className = className;
    image.src = url;
    image.alt = Files.fileName(file);
    image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    container.appendChild(image);
    return image;
  }

  async function renameFile(file) {
    const current = file.name || file.stored_name || '';
    const nextName = await GP.promptLine(`rename ${current} to:`);
    if (!nextName.trim()) {
      GP.write('rename canceled');
      return;
    }
    try {
      const result = await GP.api('/api/id/files/rename', {
        method: 'POST',
        body: JSON.stringify({ file_id: file.file_id, name: nextName })
      });
      GP.write(`renamed: ${result.file.name || result.file.stored_name}`);
      await GP.myDatabase();
    } catch (error) {
      GP.write(error.message || 'rename failed', 'error');
    }
  }

  async function deleteFile(file) {
    const name = Files.fileName(file);
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await GP.api('/api/id/files/delete', {
        method: 'POST',
        body: JSON.stringify({ file_id: file.file_id })
      });
      GP.write(`deleted: ${name}`);
      await GP.myDatabase();
    } catch (error) {
      GP.write(error.message || 'delete failed', 'error');
    }
  }

  async function sendFileToBoard(file, text = '') {
    await GP.api('/api/board/posts', {
      method: 'POST',
      body: JSON.stringify({
        category: 'General',
        text: text || `GhostProtocol file: ${file.name || file.stored_name}`,
        image_file_id: file.file_id
      })
    });
    GP.write(`sent to board: ${file.name || file.stored_name}`);
  }

  function chatConversationText(file, history = GP.state.chatMessages) {
    const lines = [`GhostProtocol AiTool image post: ${Files.fileName(file)}`];
    const messages = Array.isArray(history) ? history.slice(-12) : [];
    if (messages.length) {
      lines.push('', 'conversation:');
      messages.forEach((message) => {
        lines.push(`${message.role}: ${message.content}`);
      });
    }
    return lines.join('\n');
  }

  async function sendChatImageToBoard(file, history) {
    await Files.sendFileToBoard(file, chatConversationText(file, history));
  }

  function isAiDocFile(file) {
    const type = String(file && file.content_type || '').toLowerCase();
    const name = Files.fileName(file).toLowerCase();
    return type.includes('ghostprotocol.aitool') || name.endsWith('.aidoc.json');
  }

  function shouldRescanQuestion(question) {
    return /\b(scan|rescan|look|observe|analy[sz]e|check|review)\b[\s\S]{0,40}\b(again|fresh|new|recheck|re-scan)\b/i.test(question)
      || /\b(scan again|look again|rescan|re-scan)\b/i.test(question);
  }

  async function loadAiDoc(file) {
    const response = await fetch(`${GP.API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`Ai Doc load failed: ${response.status}`);
    const text = await response.text();
    const doc = JSON.parse(text);
    if (!doc || doc.kind !== 'ghostprotocol_aitool_doc') throw new Error('not a GhostProtocol Ai Doc');
    return doc;
  }

  async function openAiDoc(file, row) {
    try {
      const doc = await loadAiDoc(file);
      const source = doc.source_file;
      if (!source || !source.file_id) throw new Error('Ai Doc source file is missing.');
      await openChatImage(source, Files.isImageFile(source) ? [source] : [], doc);
    } catch (error) {
      GP.write(error.message || 'Ai Doc open failed', 'error');
      if (row) await readTextFile(file, row).catch(() => {});
    }
  }
  async function openChatImage(file, files = [], savedDoc = null) {
    const imageFile = Files.isImageFile(file);
    const subject = imageFile ? 'image' : 'document';
    const panel = document.createElement('div');
    panel.className = 'chat-image-container';
    const history = Array.isArray(savedDoc && savedDoc.messages) ? savedDoc.messages.map((message) => ({
      role: String(message.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '')
    })).filter((message) => message.content.trim()).slice(-80) : [];
    const request = new AbortController();
    let busy = false;
    let savedAnalysis = savedDoc && savedDoc.analysis ? savedDoc.analysis : null;
    let savedDocFile = null;

    const header = document.createElement('div');
    header.className = 'chat-image-header';
    const title = document.createElement('span');
    title.textContent = savedDoc && savedDoc.title ? `${savedDoc.title} / ${Files.fileName(file)}` : Files.fileName(file);
    header.appendChild(title);
    const observe = Files.actionButton(imageFile ? 'observe image' : 'summarize', () => submitQuestion(imageFile ? 'Describe what you see in this image.' : 'Summarize this document.'));
    const scanAgain = Files.actionButton(imageFile ? 'scan again' : 'read again', () => submitQuestion(imageFile ? 'Scan the image again and describe any updated details.' : 'Read this document again and summarize it.', { rescan: true }));
    const saveDoc = Files.actionButton('save Ai Doc', () => saveAiDoc().catch((error) => appendLine(error.message || 'save failed', 'error')));
    header.appendChild(observe);
    header.appendChild(scanAgain);
    header.appendChild(saveDoc);
    if (imageFile) header.appendChild(Files.actionButton('send to board', () => sendChatImageToBoard(file, history).catch((error) => appendLine(error.message, 'error'))));
    header.appendChild(Files.actionButton('close', () => {
      request.abort();
      panel.remove();
    }));
    panel.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'chat-image-stage';
    const layout = document.createElement('div');
    layout.className = 'chat-image-layout';
    const conversation = document.createElement('section');
    conversation.className = 'chat-image-conversation';
    conversation.setAttribute('aria-label', `Ask AiTool about ${Files.fileName(file)}`);
    const messages = document.createElement('div');
    messages.className = 'chat-image-messages';
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');
    const status = document.createElement('div');
    status.className = 'chat-image-status hint';
    status.setAttribute('role', 'status');
    const form = document.createElement('form');
    form.className = 'chat-image-compose';
    const input = document.createElement('textarea');
    input.rows = 2;
    input.maxLength = 2000;
    input.placeholder = `Ask about this ${subject}...`;
    input.setAttribute('aria-label', `Question about ${Files.fileName(file)}`);
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'send';
    form.append(input, send);
    conversation.append(messages, status, form);
    layout.append(stage, conversation);
    panel.appendChild(layout);

    function appendLine(text, kind = '') {
      const line = document.createElement('div');
      line.className = `line ${kind}`;
      line.textContent = text;
      messages.appendChild(line);
      messages.scrollTop = messages.scrollHeight;
    }

    function renderSavedHistory() {
      if (!history.length) return;
      appendLine('Ai Doc restored. Continuing saved conversation.', 'hint');
      history.forEach((message) => {
        if (message.role === 'assistant' && GP.writeAiReply) GP.writeAiReply(message.content, messages);
        else appendLine(`you> ${message.content}`);
      });
      messages.scrollTop = messages.scrollHeight;
    }

    async function saveAiDoc() {
      if (!GP.requireAccount()) return;
      if (!history.length) throw new Error('nothing to save yet');
      saveDoc.disabled = true;
      status.textContent = 'saving Ai Doc...';
      status.classList.add('terminal-pulse');
      try {
        const data = await GP.api('/api/id/aidocs/save', {
          method: 'POST',
          body: JSON.stringify({
            source_file_id: file.file_id,
            title: `${Files.fileName(file)} AiTool`,
            messages: history,
            analysis: savedAnalysis
          })
        });
        savedDocFile = data.file || null;
        appendLine(`saved Ai Doc: ${savedDocFile ? Files.fileName(savedDocFile) : 'Documents/Ai Docs'}`, 'hint');
      } finally {
        saveDoc.disabled = false;
        status.textContent = '';
        status.classList.remove('terminal-pulse');
      }
    }

    async function submitQuestion(value, options = {}) {
      const question = value.trim();
      if (!question || busy || !GP.requireAccount()) return;
      const rescan = Boolean(options.rescan || shouldRescanQuestion(question) || (imageFile && !savedAnalysis));
      busy = true;
      send.disabled = observe.disabled = scanAgain.disabled = saveDoc.disabled = true;
      input.value = '';
      appendLine(`you> ${question}`);
      status.textContent = rescan ? `scanning ${subject}...` : `using saved ${subject} scan...`;
      status.classList.add('terminal-pulse');
      try {
        const conversationMemory = history.slice(-14).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 2000)
        }));
        const data = await GP.api('/api/id/file/explain', {
          method: 'POST',
          signal: request.signal,
          body: JSON.stringify({
            file_id: file.file_id,
            question,
            conversation: conversationMemory,
            analysis: savedAnalysis,
            rescan
          })
        });
        if (!panel.isConnected) return;
        const reply = String(data.reply || '').trim();
        if (!reply) throw new Error('empty AI reply');
        if (data.analysis) savedAnalysis = data.analysis;
        history.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
        GP.writeAiReply(reply, messages);
        if (imageFile && data.cached_analysis) appendLine('used saved image scan', 'hint');
      } catch (error) {
        if (!request.signal.aborted && panel.isConnected) {
          appendLine(error.message || 'image AiTool failed', 'error');
          if (!input.value) input.value = question;
        }
      } finally {
        busy = false;
        send.disabled = observe.disabled = scanAgain.disabled = saveDoc.disabled = false;
        status.textContent = '';
        status.classList.remove('terminal-pulse');
      }
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void submitQuestion(input.value);
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    if (files.length > 1) {
      const strip = document.createElement('div');
      strip.className = 'chat-image-strip';
      files.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-image-strip-item';
        button.textContent = Files.fileName(item);
        button.addEventListener('click', () => openChatImage(item, files));
        strip.appendChild(button);
      });
      panel.appendChild(strip);
    }

    GP.dom.screen.appendChild(panel);
    renderSavedHistory();
    const reviewing = GP.animatedStatusLine ? GP.animatedStatusLine('loading image') : null;
    try {
      if (imageFile) await loadFxImage(file, stage, 'chat-image-large');
      else if (Files.isTextDocument(file)) await readTextFile(file, stage);
      else stage.textContent = 'Content interpretation is not available for this format yet. Questions use file details only.';
      if (reviewing) reviewing.remove();
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      stage.textContent = error.message || 'image preview failed';
    }
  }
  function renderChatImageDatabase(files) {
    const groups = Files.categorizedFiles(files);
    if (GP.state.databaseElement) GP.state.databaseElement.remove();
    GP.write(`MyDatabase: ${files.length} files`);
    const panel = document.createElement('div');
    panel.className = 'database-panel';
    GP.state.databaseElement = panel;
    function renderLinks(items, body) {
      items.forEach((file, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-image-link';
      button.textContent = `${index + 1}) ${Files.fileName(file)}`;
      button.addEventListener('click', () => {
        if (Files.isAiDocFile && Files.isAiDocFile(file)) openAiDoc(file, button);
        else openChatImage(file, Files.isImageFile(file) ? groups.images : []);
      });
      body.appendChild(button);
      });
    }
    panel.appendChild(Files.databaseSection('Images', groups.images, renderLinks));
    ['Audio', 'Video'].forEach((label) => {
      panel.appendChild(Files.databaseSection(label, groups[label.toLowerCase()], (items, body) => {
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = `${label} interpretation is not available yet.`;
        body.appendChild(note);
        items.forEach((file) => {
          const row = document.createElement('div');
          row.className = 'line';
          row.textContent = Files.fileName(file);
          row.appendChild(Files.actionButton('download', () => Files.downloadFile(file).catch(error => GP.write(error.message, 'error'))));
          body.appendChild(row);
        });
      }));
    });
    panel.appendChild(Files.databaseSection('Documents', groups.documents, renderLinks));
    GP.dom.screen.appendChild(panel);
    GP.autoScroll();
  }

  async function fetchBoardImage(entry, container) {
    const imageInfo = entry && (entry.image || entry);
    const fileId = imageInfo && (imageInfo.image_file_id || imageInfo.file_id);
    if (!fileId) return;
    try {
      const response = await fetch(`${GP.API_BASE}/api/board/image?file_id=${encodeURIComponent(fileId)}&fx=1`, {
        headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
      });
      if (!response.ok) throw new Error(`image unavailable: ${response.status}`);
      const blob = await response.blob();
      if (!container.isConnected) return;
      const url = URL.createObjectURL(blob);
      const image = document.createElement('img');
      image.src = url;
      image.alt = imageInfo.image_name || imageInfo.file_name || imageInfo.name || 'board image';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      image.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      container.appendChild(image);
    } catch (error) {
      const failed = document.createElement('div');
      failed.className = 'line error';
      failed.textContent = error.message || 'image preview failed';
      container.appendChild(failed);
    }
  }

  async function readTextFile(file, row) {
    if (!Files.isTextDocument(file)) {
      GP.write('read preview is available for text documents only.', 'error');
      return;
    }
    const existing = row.querySelector('.document-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const response = await fetch(`${GP.API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
        headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
      });
      if (!response.ok) throw new Error(`read failed: ${response.status}`);
      const text = await response.text();
      const preview = document.createElement('pre');
      preview.className = 'document-preview';
      preview.textContent = text.slice(0, 12000);
      if (text.length > 12000) preview.textContent += '\n\n[preview truncated]';
      row.appendChild(preview);
      GP.autoScroll();
    } catch (error) {
      GP.write(error.message || 'read failed', 'error');
    }
  }

  Files.viewFile = viewFile;
  Files.loadFxImage = loadFxImage;
  Files.renameFile = renameFile;
  Files.deleteFile = deleteFile;
  Files.sendFileToBoard = sendFileToBoard;
  Files.chatConversationText = chatConversationText;
  Files.sendChatImageToBoard = sendChatImageToBoard;
  Files.isAiDocFile = isAiDocFile;
  Files.openAiDoc = openAiDoc;
  Files.openChatImage = openChatImage;
  Files.renderChatImageDatabase = renderChatImageDatabase;
  Files.fetchBoardImage = fetchBoardImage;
  Files.readTextFile = readTextFile;

  GP.sendFileToBoard = sendFileToBoard;
  GP.sendChatImageToBoard = sendChatImageToBoard;
  GP.openChatImage = openChatImage;
  GP.fetchBoardImage = fetchBoardImage;
})(window.GhostProtocol);





