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
      if (Files.isAiDocFile && Files.isAiDocFile(file)) {
        row.appendChild(Files.actionButton('open Ai Doc', () => Files.openAiDoc(file, row)));
      } else if (options.read && Files.isTextDocument(file)) {
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
          preview.appendChild(Files.actionButton('close image', () => {
            preview.replaceChildren();
            preview.hidden = true;
          }));
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

    let activeMode = '';
    const modeButtons = new Map();
    function closeMode() {
      activeMode = '';
      content.replaceChildren();
      modeButtons.forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
    for (const [name, render] of [['gallery', renderGallery], ['scroll', renderScroller], ['list', renderList]]) {
      const button = Files.actionButton(name, () => {
        if (activeMode === name) { closeMode(); return; }
        closeMode();
        activeMode = name;
        button.setAttribute('aria-expanded', 'true');
        render();
        content.prepend(Files.actionButton('close view', closeMode));
      });
      button.setAttribute('aria-expanded', 'false');
      modeButtons.set(name, button);
      controls.appendChild(button);
    }
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

  const databaseCategories = { images: 'Images', audio: 'Audio', video: 'Video', documents: 'Documents' };
  let databaseRequest = 0;

  function closeDatabase() {
    databaseRequest += 1;
    document.querySelector('.database-session-status')?.remove();
    GP.state.databaseOpen = false;
    GP.state.databaseCategory = '';
    GP.state.databaseLoading = false;
    GP.state.databaseElement?.remove();
    GP.state.databaseElement = null;
    GP.renderMailHint?.();
  }

  function selectDatabaseCategory(category, toggle = false) {
    if ((category && !Object.hasOwn(databaseCategories, category)) || !GP.state.databaseOpen || !GP.state.account) return;
    if (toggle && GP.state.databaseCategory === category) category = '';
    GP.state.databaseCategory = category;
    GP.renderMailHint?.();
    const content = GP.state.databaseElement?.querySelector('#databaseContent');
    if (!content || GP.state.databaseLoading) return;
    content.replaceChildren();
    if (!category) {
      content.removeAttribute('aria-label');
      return;
    }
    const files = Files.categorizedFiles(GP.state.files)[category];
    const title = document.createElement('div');
    title.className = 'line';
    title.textContent = `${databaseCategories[category]} (${files.length})`;
    content.setAttribute('aria-label', databaseCategories[category]);
    content.appendChild(title);
    title.appendChild(Files.actionButton('close category', () => selectDatabaseCategory('')));
    const body = document.createElement('div');
    content.appendChild(body);
    if (!files.length) body.textContent = 'empty';
    else if (category === 'images') renderImageModes(files, body);
    else renderFileRows(files, body, { read: category === 'documents', inspectDb: category === 'documents' });
    GP.autoScroll();
  }

  async function myDatabase() {
    if (!GP.requireAccount()) return;
    const account = GP.state.account;
    const session = GP.token();
    const request = ++databaseRequest;
    const inChat = GP.state.chatMode;
    const current = () => request === databaseRequest && GP.state.account === account && GP.token() === session;
    let database;
    let summary;
    if (!inChat) {
      GP.closeLobby?.();
      GP.closeBoard?.(true);
      GP.state.databaseCategory = '';
      GP.state.databaseOpen = true;
      GP.state.databaseLoading = true;
      GP.state.headerHint = undefined;
      GP.state.databaseElement?.remove();
      database = document.createElement('section');
      database.className = 'database-panel';
      database.setAttribute('aria-label', 'MyDatabase');
      document.querySelector('.database-session-status')?.remove();
      summary = document.createElement('span');
      summary.className = 'database-session-status';
      summary.setAttribute('role', 'status');
      summary.textContent = ' / MyDatabase: loading...';
      GP.dom.connectionState.insertAdjacentElement('afterend', summary);
      const content = document.createElement('div');
      content.id = 'databaseContent';
      content.setAttribute('role', 'region');
      database.appendChild(content);
      GP.state.databaseElement = database;
      GP.dom.screen.appendChild(database);
      GP.renderMailHint?.();
      GP.autoScroll();
    }
    try {
      const data = await GP.api('/api/id/files');
      if (!current()) return;
      GP.state.files = data.files || [];
      if (inChat) {
        if (GP.state.chatMode) Files.renderChatImageDatabase(GP.state.files);
        return;
      }
      if (!database.isConnected) return;
      GP.state.databaseLoading = false;
      summary.textContent = ` / MyDatabase: ${GP.state.files.length} files`;
      selectDatabaseCategory(GP.state.databaseCategory);
    } catch (error) {
      if (!current()) return;
      GP.state.databaseLoading = false;
      if (summary?.isConnected) {
        summary.textContent = ` / MyDatabase: ${error.message || 'unavailable'}`;
        summary.classList.add('error');
      } else if (inChat && GP.state.chatMode) GP.write(error.message || 'database unavailable', 'error');
    }
  }

  Files.renderFileRows = renderFileRows;
  Files.renderImageModes = renderImageModes;
  Files.databaseSection = databaseSection;
  Files.databaseCategories = databaseCategories;
  Files.selectDatabaseCategory = selectDatabaseCategory;
  Files.myDatabase = myDatabase;

  GP.closeDatabase = closeDatabase;
  GP.myDatabase = myDatabase;
})(window.GhostProtocol);

