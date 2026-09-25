(function (GP) {
  const Files = GP.Files = GP.Files || {};
  function renderFileRows(files, sectionBody, options = {}) {
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.textContent = `${index + 1}) ${Files.fileMeta(file)}`;
      sectionBody.appendChild(row);
      row.appendChild(document.createElement('br'));
      if (options.view && Files.isImageFile(file)) {
        row.appendChild(Files.actionButton('view', () => Files.viewFile(file, row)));
      }
      if (options.analyze && Files.isImageFile(file)) {
        row.appendChild(Files.actionButton('analyze', () => Files.analyzeImage(file, row)));
        row.appendChild(Files.actionButton('notes', () => Files.showImageAnalysis(file, row)));
      }
      if (options.read && Files.isTextDocument(file)) {
        row.appendChild(Files.actionButton('read', () => Files.readTextFile(file, row)));
      }
      if (options.inspectDb && Files.isDb3Document(file)) {
        row.appendChild(Files.actionButton('inspect db3', () => Files.inspectDb3File(file, row)));
      }
      if (GP.state.chatMode) {
        row.appendChild(Files.actionButton('ask ai', () => Files.askAiAboutFile(file, row)));
      }
      row.appendChild(Files.actionButton('download', () => Files.downloadFile(file).catch((error) => GP.write(error.message, 'error'))));
      row.appendChild(Files.actionButton('rename', () => Files.renameFile(file)));
      row.appendChild(Files.actionButton('delete', () => Files.deleteFile(file)));
      if (options.board) {
        row.appendChild(Files.actionButton('send to board', () => Files.sendFileToBoard(file).catch((error) => GP.write(error.message, 'error'))));
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
        slot.setAttribute('aria-label', `open ${Files.fileName(file)}`);
        fetch(`${GP.API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(file.file_id)}`, {
          headers: { 'X-ID-Session': GP.token(), 'X-Device-ID': GP.deviceId() }
        }).then((response) => {
          if (!response.ok) throw new Error(`preview failed: ${response.status}`);
          return response.blob();
        }).then((blob) => {
          const url = URL.createObjectURL(blob);
          const image = document.createElement('img');
          image.src = url;
          image.alt = Files.fileName(file);
          image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
          slot.appendChild(image);
        }).catch(() => {
          slot.classList.add('is-unavailable');
        });
        slot.addEventListener('click', () => {
          preview.hidden = false;
          preview.innerHTML = '';
          void Files.viewFile(file, preview);
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
        counter.textContent = `${activeIndex + 1}/${files.length} ${Files.fileName(files[activeIndex])}`;
        [...strip.querySelectorAll('.image-loop-thumb')].forEach((button, thumbIndex) => {
          button.classList.toggle('is-active', thumbIndex === activeIndex);
        });
        const activeThumb = strip.querySelector(`[data-index="${activeIndex}"]`);
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        large.innerHTML = '';
        Files.loadFxImage(files[activeIndex], large, 'image-loop-large-image').catch((error) => {
          large.textContent = error.message || 'image preview failed';
        });
      }

      controlsRow.appendChild(Files.actionButton('<', () => setActive(activeIndex - 1)));
      controlsRow.appendChild(counter);
      controlsRow.appendChild(Files.actionButton('>', () => setActive(activeIndex + 1)));

      files.forEach((file, index) => {
        const thumb = document.createElement('button');
        thumb.className = 'image-loop-thumb';
        thumb.type = 'button';
        thumb.dataset.index = String(index);
        thumb.setAttribute('aria-label', `open ${Files.fileName(file)}`);
        thumb.addEventListener('click', () => setActive(index));
        Files.loadFxImage(file, thumb, 'image-loop-thumb-image').catch(() => {
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

    controls.appendChild(Files.actionButton('gallery', renderGallery));
    controls.appendChild(Files.actionButton('scroll', renderScroller));
    controls.appendChild(Files.actionButton('list', renderList));
    sectionBody.appendChild(controls);
    sectionBody.appendChild(content);
  }

  function databaseSection(label, files, renderer, resetOnClose = false) {
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
      if (body.hidden && resetOnClose) {
        body.replaceChildren();
        delete body.dataset.rendered;
      }
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
      if (GP.state.chatMode) {
        Files.renderChatImageDatabase(GP.state.files);
        return;
      }
      GP.write(`MyDatabase: ${GP.state.files.length} files`);
      if (!GP.state.files.length) {
        GP.write('empty');
        return;
      }
      const groups = Files.categorizedFiles(GP.state.files);
      if (GP.state.databaseElement) GP.state.databaseElement.remove();
      const database = document.createElement('div');
      database.className = 'database-panel';
      GP.state.databaseElement = database;
      database.appendChild(databaseSection('Images', groups.images, renderImageModes, true));
      database.appendChild(databaseSection('Audio', groups.audio, (files, body) => renderFileRows(files, body)));
      database.appendChild(databaseSection('Video', groups.video, (files, body) => renderFileRows(files, body)));
      database.appendChild(databaseSection('Documents', groups.documents, (files, body) => renderFileRows(files, body, { read: true, inspectDb: true })));
      GP.dom.screen.appendChild(database);
      GP.dom.screen.scrollTop = GP.dom.screen.scrollHeight;
    } catch (error) {
      GP.write(error.message || 'database unavailable', 'error');
    }
  }

  Files.renderFileRows = renderFileRows;
  Files.renderImageModes = renderImageModes;
  Files.databaseSection = databaseSection;
  Files.myDatabase = myDatabase;

  GP.myDatabase = myDatabase;
})(window.GhostProtocol);
