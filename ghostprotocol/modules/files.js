(function (GP) {
  async function uploadFile(file, folder = 'ghost') {
    const started = await GP.api('/api/id/files/upload/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name || 'ghost-upload.bin',
        folder,
        content_type: file.type || 'application/octet-stream',
        size: file.size
      })
    });
    const uploadId = started.upload_id;
    const chunkSize = Number(started.chunk_size || (8 * 1024 * 1024));
    let offset = Number(started.received || 0);
    try {
      while (offset < file.size) {
        const next = Math.min(offset + chunkSize, file.size);
        const chunk = file.slice(offset, next);
        const result = await GP.api(`/api/id/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
        offset = Number(result.received || next);
        GP.write(`upload ${Math.floor((offset / file.size) * 100)}%`);
      }
      return GP.api('/api/id/files/upload/finish', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      });
    } catch (error) {
      await GP.api('/api/id/files/upload/cancel', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      }).catch(() => {});
      throw error;
    }
  }

  function chooseFile(inputElement) {
    return new Promise((resolve) => {
      inputElement.value = '';
      inputElement.onchange = () => resolve(inputElement.files && inputElement.files[0]);
      inputElement.click();
    });
  }

  async function upload() {
    if (!GP.requireAccount()) return;
    const file = await chooseFile(GP.dom.fileInput);
    if (!file) {
      GP.write('upload canceled');
      return;
    }
    try {
      GP.write(`uploading ${file.name}...`);
      const result = await uploadFile(file);
      GP.write(`stored ${result.file.name || result.file.stored_name} (${GP.formatBytes(result.file.size)})`);
    } catch (error) {
      GP.write(error.message || 'upload failed', 'error');
    }
  }

  async function camera() {
    if (!GP.requireAccount()) return;
    const file = await chooseFile(GP.dom.cameraInput);
    if (!file) {
      GP.write('camera canceled');
      return;
    }
    try {
      GP.write('sending camera image...');
      const result = await uploadFile(file, 'camera');
      GP.write(`stored ${result.file.name || result.file.stored_name} (${GP.formatBytes(result.file.size)})`);
    } catch (error) {
      GP.write(error.message || 'camera failed', 'error');
    }
  }

  async function downloadFile(file) {
    const response = await fetch(`${GP.API_BASE}/api/id/file?file_id=${encodeURIComponent(file.file_id)}`, {
      headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
    });
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name || file.stored_name || 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function isImageFile(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = String(file.name || file.stored_name || '').toLowerCase();
    return type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|webp)$/.test(name);
  }

  function fileName(file) {
    return file.name || file.stored_name || 'file';
  }

  function fileType(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = fileName(file).toLowerCase();
    if (isImageFile(file)) return 'images';
    if (type.startsWith('audio/') || /\.(aac|aiff?|flac|m4a|mid|midi|mp3|ogg|opus|wav|weba)$/.test(name)) return 'audio';
    if (type.startsWith('video/') || /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(name)) return 'video';
    return 'documents';
  }

  function isTextDocument(file) {
    const type = String(file.content_type || '').toLowerCase();
    const name = fileName(file).toLowerCase();
    return type.startsWith('text/') || /\.(css|csv|html?|js|json|log|md|py|txt|xml|yaml|yml)$/.test(name);
  }

  function isDb3Document(file) {
    return /\.(db|db3|sqlite|sqlite3)$/.test(fileName(file).toLowerCase());
  }

  function categorizedFiles(files) {
    return {
      images: files.filter((file) => fileType(file) === 'images'),
      audio: files.filter((file) => fileType(file) === 'audio'),
      video: files.filter((file) => fileType(file) === 'video'),
      documents: files.filter((file) => fileType(file) === 'documents')
    };
  }

  function fileMeta(file) {
    return `${fileName(file)} / ${GP.formatBytes(file.size)} / ${file.folder || 'root'}`;
  }

  function actionButton(label, handler) {
    const button = document.createElement('button');
    button.className = 'terminal-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function viewFile(file, row) {
    if (!isImageFile(file)) {
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
    image.alt = fileName(file);
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
      await myDatabase();
    } catch (error) {
      GP.write(error.message || 'rename failed', 'error');
    }
  }

  async function deleteFile(file) {
    const name = fileName(file);
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await GP.api('/api/id/files/delete', {
        method: 'POST',
        body: JSON.stringify({ file_id: file.file_id })
      });
      GP.write(`deleted: ${name}`);
      await myDatabase();
    } catch (error) {
      GP.write(error.message || 'delete failed', 'error');
    }
  }

  async function sendFileToBoard(file) {
    await GP.api('/api/board/posts', {
      method: 'POST',
      body: JSON.stringify({
        category: 'General',
        text: `GhostProtocol file: ${file.name || file.stored_name}`,
        image_file_id: file.file_id
      })
    });
    GP.write(`sent to board: ${file.name || file.stored_name}`);
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
      const url = URL.createObjectURL(blob);
      const image = document.createElement('img');
      image.src = url;
      image.alt = imageInfo.image_name || imageInfo.file_name || imageInfo.name || 'board image';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      container.appendChild(image);
    } catch (error) {
      const failed = document.createElement('div');
      failed.className = 'line error';
      failed.textContent = error.message || 'image preview failed';
      container.appendChild(failed);
    }
  }

  async function readTextFile(file, row) {
    if (!isTextDocument(file)) {
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

  async function inspectDb3File(file, row) {
    if (!isDb3Document(file)) {
      GP.write('database preview is available for .db, .db3, .sqlite, and .sqlite3 files only.', 'error');
      return;
    }
    const existing = row.querySelector('.document-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const data = await GP.api(`/api/id/file/db3?file_id=${encodeURIComponent(file.file_id)}`);
      const preview = document.createElement('pre');
      preview.className = 'document-preview';
      preview.textContent = data.preview || 'No database preview available.';
      row.appendChild(preview);
      GP.autoScroll();
    } catch (error) {
      GP.write(error.message || 'database inspect failed', 'error');
    }
  }

  async function askAiAboutFile(file, row) {
    let reviewing = null;
    try {
      const question = await GP.promptLine(`ask AI about ${fileName(file)}:`);
      reviewing = GP.animatedStatusLine ? GP.animatedStatusLine(isImageFile(file) ? 'reviewing image' : 'AI thinking') : null;
      const data = await GP.api('/api/id/file/explain', {
        method: 'POST',
        body: JSON.stringify({
          file_id: file.file_id,
          question: question.trim() || 'Tell me what this file is.'
        })
      });
      if (reviewing) reviewing.remove();
      const reply = String(data.reply || '').trim();
      if (!reply) throw new Error('empty AI reply');
      if (GP.writeAiReply) GP.writeAiReply(reply);
      else GP.write(`ai> ${reply}`);
      if (GP.state.chatMessages) {
        GP.state.chatMessages.push({ role: 'user', content: `[MyDatabase file: ${fileName(file)}] ${question.trim() || 'Tell me what this file is.'}` });
        GP.state.chatMessages.push({ role: 'assistant', content: reply });
      }
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      GP.write(error.message || 'file interpretation failed', 'error');
    }
  }

  function formatVisionAnalysis(data) {
    const analysis = data.analysis || {};
    const lines = ['AI image notes'];
    if (data.analyzer) {
      lines.push(`local only: ${data.analyzer.local_only ? 'yes' : 'no'}`);
      lines.push(`model: ${data.analyzer.model || 'local-qwen-vl'}`);
    }
    if (data.analyzed_at) lines.push(`analyzed: ${data.analyzed_at}`);
    lines.push('');
    lines.push(`caption: ${analysis.caption || 'no caption available'}`);
    if (Array.isArray(analysis.visible_text) && analysis.visible_text.length) {
      lines.push(`visible text: ${analysis.visible_text.join(' | ')}`);
    }
    if (Array.isArray(analysis.objects) && analysis.objects.length) {
      lines.push(`objects: ${analysis.objects.map((item) => (
        typeof item === 'string' ? item : (item.label || JSON.stringify(item))
      )).join(', ')}`);
    }
    if (analysis.people_count !== undefined && analysis.people_count !== null) {
      lines.push(`people count: ${analysis.people_count}`);
    }
    if (analysis.safe_person_notes) lines.push(`person notes: ${analysis.safe_person_notes}`);
    if (Array.isArray(analysis.warnings) && analysis.warnings.length) {
      lines.push(`warnings: ${analysis.warnings.join(' | ')}`);
    }
    if (analysis.confidence) lines.push(`confidence: ${analysis.confidence}`);
    if (analysis.metadata) {
      const width = analysis.metadata.width || '?';
      const height = analysis.metadata.height || '?';
      lines.push(`metadata: ${width}x${height} ${analysis.metadata.format || ''}`.trim());
    }
    if (analysis.raw_output) {
      lines.push('', 'raw output:', String(analysis.raw_output).slice(0, 4000));
    }
    return lines.join('\n');
  }

  async function showImageAnalysis(file, row) {
    const existing = row.querySelector('.vision-preview');
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const data = await GP.api(`/api/id/file/analysis?file_id=${encodeURIComponent(file.file_id)}`);
      const preview = document.createElement('pre');
      preview.className = 'document-preview vision-preview';
      preview.textContent = formatVisionAnalysis(data);
      row.appendChild(preview);
      GP.autoScroll();
    } catch (error) {
      GP.write(error.message || 'no image notes saved yet', 'error');
    }
  }

  async function analyzeImage(file, row) {
    const reviewing = GP.animatedStatusLine ? GP.animatedStatusLine('reviewing image') : null;
    try {
      const data = await GP.api(`/api/id/file/analyze?file_id=${encodeURIComponent(file.file_id)}`, { method: 'POST' });
      const existing = row.querySelector('.vision-preview');
      if (existing) existing.remove();
      const preview = document.createElement('pre');
      preview.className = 'document-preview vision-preview';
      preview.textContent = formatVisionAnalysis(data);
      row.appendChild(preview);
      if (reviewing) reviewing.remove();
      GP.write(`image notes saved: ${fileName(file)}`);
      GP.autoScroll();
    } catch (error) {
      if (reviewing) reviewing.remove();
      GP.write(error.message || 'image analysis failed', 'error');
    }
  }

  function renderFileRows(files, sectionBody, options = {}) {
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.textContent = `${index + 1}) ${fileMeta(file)}`;
      sectionBody.appendChild(row);
      row.appendChild(document.createElement('br'));
      if (options.view && isImageFile(file)) {
        row.appendChild(actionButton('view', () => viewFile(file, row)));
      }
      if (options.analyze && isImageFile(file)) {
        row.appendChild(actionButton('analyze', () => analyzeImage(file, row)));
        row.appendChild(actionButton('notes', () => showImageAnalysis(file, row)));
      }
      if (options.read && isTextDocument(file)) {
        row.appendChild(actionButton('read', () => readTextFile(file, row)));
      }
      if (options.inspectDb && isDb3Document(file)) {
        row.appendChild(actionButton('inspect db3', () => inspectDb3File(file, row)));
      }
      if (GP.state.chatMode) {
        row.appendChild(actionButton('ask ai', () => askAiAboutFile(file, row)));
      }
      row.appendChild(actionButton('download', () => downloadFile(file).catch((error) => GP.write(error.message, 'error'))));
      row.appendChild(actionButton('rename', () => renameFile(file)));
      row.appendChild(actionButton('delete', () => deleteFile(file)));
      if (options.board) {
        row.appendChild(actionButton('send to board', () => sendFileToBoard(file).catch((error) => GP.write(error.message, 'error'))));
      }
    });
  }

  function renderImageModes(files, sectionBody) {
    const controls = document.createElement('div');
    controls.className = 'image-mode-controls';
    const content = document.createElement('div');
    content.className = 'image-mode-content';

    function renderList() {
      content.innerHTML = '';
      renderFileRows(files, content, { view: true, analyze: true, board: true });
      GP.autoScroll();
    }

    function renderGallery() {
      content.innerHTML = '';
      const gallery = document.createElement('div');
      gallery.className = 'image-gallery-grid';
      const preview = document.createElement('div');
      preview.className = 'image-gallery-preview';
      preview.hidden = true;
      const slots = 20;

      for (let index = 0; index < slots; index += 1) {
        const file = files[index];
        const slot = document.createElement(file ? 'button' : 'div');
        slot.className = 'image-gallery-slot';
        if (!file) {
          slot.setAttribute('aria-hidden', 'true');
          gallery.appendChild(slot);
          continue;
        }
        slot.type = 'button';
        slot.setAttribute('aria-label', `open ${fileName(file)}`);
        fetch(`${GP.API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(file.file_id)}`, {
          headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
        }).then((response) => {
          if (!response.ok) throw new Error(`preview failed: ${response.status}`);
          return response.blob();
        }).then((blob) => {
          const url = URL.createObjectURL(blob);
          const image = document.createElement('img');
          image.src = url;
          image.alt = fileName(file);
          image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
          slot.appendChild(image);
        }).catch(() => {
          slot.classList.add('is-unavailable');
        });
        slot.addEventListener('click', () => {
          preview.hidden = false;
          preview.innerHTML = '';
          void viewFile(file, preview);
        });
        gallery.appendChild(slot);
      }

      content.appendChild(gallery);
      content.appendChild(preview);
      GP.autoScroll();
    }

    function renderScroller() {
      content.innerHTML = '';
      if (!files.length) {
        content.textContent = 'empty';
        return;
      }

      let activeIndex = 0;
      const viewer = document.createElement('div');
      viewer.className = 'image-loop-viewer';
      const controlsRow = document.createElement('div');
      controlsRow.className = 'image-loop-controls';
      const counter = document.createElement('span');
      counter.className = 'image-loop-counter';
      const strip = document.createElement('div');
      strip.className = 'image-loop-strip';
      const large = document.createElement('div');
      large.className = 'image-loop-large';

      function setActive(index) {
        activeIndex = (index + files.length) % files.length;
        counter.textContent = `${activeIndex + 1}/${files.length} ${fileName(files[activeIndex])}`;
        [...strip.querySelectorAll('.image-loop-thumb')].forEach((button, thumbIndex) => {
          button.classList.toggle('is-active', thumbIndex === activeIndex);
        });
        const activeThumb = strip.querySelector(`[data-index="${activeIndex}"]`);
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        large.innerHTML = '';
        loadFxImage(files[activeIndex], large, 'image-loop-large-image').catch((error) => {
          large.textContent = error.message || 'image preview failed';
        });
      }

      controlsRow.appendChild(actionButton('<', () => setActive(activeIndex - 1)));
      controlsRow.appendChild(counter);
      controlsRow.appendChild(actionButton('>', () => setActive(activeIndex + 1)));

      files.forEach((file, index) => {
        const thumb = document.createElement('button');
        thumb.className = 'image-loop-thumb';
        thumb.type = 'button';
        thumb.dataset.index = String(index);
        thumb.setAttribute('aria-label', `open ${fileName(file)}`);
        thumb.addEventListener('click', () => setActive(index));
        loadFxImage(file, thumb, 'image-loop-thumb-image').catch(() => {
          thumb.classList.add('is-unavailable');
        });
        strip.appendChild(thumb);
      });

      strip.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      }, { passive: false });

      viewer.appendChild(controlsRow);
      viewer.appendChild(strip);
      viewer.appendChild(large);
      content.appendChild(viewer);
      setActive(0);
      GP.autoScroll();
    }

    controls.appendChild(actionButton('gallery', renderGallery));
    controls.appendChild(actionButton('scroll', renderScroller));
    controls.appendChild(actionButton('list', renderList));
    sectionBody.appendChild(controls);
    sectionBody.appendChild(content);
    renderList();
  }

  function databaseSection(label, files, renderer) {
    const section = document.createElement('div');
    section.className = 'database-section';
    const toggle = document.createElement('button');
    toggle.className = 'database-section-toggle';
    toggle.type = 'button';
    toggle.textContent = `${label} (${files.length})`;
    const body = document.createElement('div');
    body.className = 'database-section-body';
    body.hidden = true;
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      if (!body.hidden && !body.dataset.rendered) {
        body.dataset.rendered = '1';
        if (files.length) renderer(files, body);
        else body.textContent = 'empty';
      }
      GP.autoScroll();
    });
    section.appendChild(toggle);
    section.appendChild(body);
    return section;
  }

  async function myDatabase() {
    if (!GP.requireAccount()) return;
    try {
      const data = await GP.api('/api/id/files');
      GP.state.files = data.files || [];
      GP.write(`MyDatabase: ${GP.state.files.length} files`);
      if (!GP.state.files.length) {
        GP.write('empty');
        return;
      }
      const groups = categorizedFiles(GP.state.files);
      if (GP.state.databaseElement) GP.state.databaseElement.remove();
      const database = document.createElement('div');
      database.className = 'database-panel';
      GP.state.databaseElement = database;
      database.appendChild(databaseSection('Images', groups.images, renderImageModes));
      database.appendChild(databaseSection('Audio', groups.audio, (files, body) => renderFileRows(files, body)));
      database.appendChild(databaseSection('Video', groups.video, (files, body) => renderFileRows(files, body)));
      database.appendChild(databaseSection('Documents', groups.documents, (files, body) => renderFileRows(files, body, { read: true, inspectDb: true })));
      GP.dom.screen.appendChild(database);
      GP.dom.screen.scrollTop = GP.dom.screen.scrollHeight;
    } catch (error) {
      GP.write(error.message || 'database unavailable', 'error');
    }
  }

  GP.upload = upload;
  GP.uploadFile = uploadFile;
  GP.chooseFile = chooseFile;
  GP.fileName = fileName;
  GP.fileMeta = fileMeta;
  GP.isImageFile = isImageFile;
  GP.isTextDocument = isTextDocument;
  GP.camera = camera;
  GP.myDatabase = myDatabase;
  GP.fetchBoardImage = fetchBoardImage;
})(window.GhostProtocol);
