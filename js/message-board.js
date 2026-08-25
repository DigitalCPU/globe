(function () {
  const RELAY_BASE = 'https://globe-qwen-relay.digitalcomputermail.workers.dev';
  const API_BASE = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '' : RELAY_BASE;
  const sessionKey = 'digitalcpu:id-session:v1';
  const panelStateKey = 'digitalcpu:message-board-open:v1';
  const opacityKey = 'digitalcpu:message-board-opacity:v1';
  const fallbackCategories = ['Alert', 'Community', 'Fire', 'General', 'News', 'Satellite', 'Weather'];

  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem(sessionKey) || '';
    if (token) headers['X-ID-Session'] = token;
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

  async function fetchBoardImageBlob(entry) {
    const fileId = entry.image && entry.image.file_id;
    if (!fileId) throw new Error('Post has no image.');
    const token = localStorage.getItem(sessionKey) || '';
    const response = await fetch(`${API_BASE}/api/board/image?file_id=${encodeURIComponent(fileId)}`, {
      headers: { 'X-ID-Session': token }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Image failed: ${response.status}`);
    }
    return response.blob();
  }

  async function uploadFileChunked(file, folder, onProgress) {
    const started = await api('/api/id/files/upload/start', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name || 'camera-image.jpg',
        folder: folder || 'board',
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
        const result = await api(`/api/id/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
        offset = Number(result.received || next);
        const percent = file.size ? Math.floor((offset / file.size) * 100) : 100;
        onProgress(`camera upload ${percent}%`);
      }
      return api('/api/id/files/upload/finish', {
        method: 'POST',
        body: JSON.stringify({ upload_id: uploadId })
      });
    } catch (error) {
      try {
        await api('/api/id/files/upload/cancel', {
          method: 'POST',
          body: JSON.stringify({ upload_id: uploadId })
        });
      } catch (cancelError) {
        console.warn('Board upload cancel failed.', cancelError);
      }
      throw error;
    }
  }

  function init() {
    const widget = $('boardWidget');
    const toggle = $('boardToggle');
    const refresh = $('boardRefresh');
    const status = $('boardStatus');
    const form = $('boardPostForm');
    const category = $('boardCategory');
    const text = $('boardText');
    const imageSelect = $('boardImageSelect');
    const cameraButton = $('boardCameraButton');
    const cameraInput = $('boardCameraInput');
    const imageRefresh = $('boardImagesRefresh');
    const opacityInput = $('boardOpacity');
    const opacityValue = $('boardOpacityValue');
    const filter = $('boardFilter');
    const list = $('boardList');
    const postButton = $('boardPostButton');
    const thread = $('boardThread');
    const threadBack = $('boardThreadBack');
    const threadStatus = $('boardThreadStatus');
    const threadRoot = $('boardThreadRoot');
    const replyList = $('boardReplyList');
    const replyForm = $('boardReplyForm');
    const replyText = $('boardReplyText');
    const replyImageSelect = $('boardReplyImageSelect');
    const replyButton = $('boardReplyButton');

    if (!widget || !toggle || !form || !category || !filter || !list || !thread || !replyForm || !replyText || !replyList) return;

    const state = {
      categories: [],
      posts: [],
      images: [],
      imageUrls: [],
      cameraFileId: '',
      activePostId: ''
    };

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('is-error', Boolean(isError));
    }

    function applyOpacity(value) {
      const numeric = Math.min(95, Math.max(35, Number(value) || 84));
      widget.style.setProperty('--board-opacity', String(numeric / 100));
      if (opacityInput) opacityInput.value = String(numeric);
      if (opacityValue) opacityValue.textContent = `${numeric}%`;
      localStorage.setItem(opacityKey, String(numeric));
    }

    function setOpen(open) {
      widget.classList.toggle('is-collapsed', !open);
      toggle.textContent = open ? '-' : '+';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Minimize message board' : 'Open message board');
      localStorage.setItem(panelStateKey, open ? '1' : '0');
      if (!open) showThreadView(false);
      if (open) {
        refreshCategories()
          .then(refreshBoard)
          .catch((error) => {
            fillCategories(fallbackCategories);
            setStatus(error.message || 'board failed', true);
          });
      }
    }

    function fillCategories(categories) {
      const previousFilter = filter.value;
      const source = Array.isArray(categories) && categories.length ? categories : fallbackCategories;
      state.categories = source.slice().sort((a, b) => a.localeCompare(b));
      category.innerHTML = '';
      filter.innerHTML = '<option value="">All categories</option>';
      state.categories.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        category.appendChild(option);
        filter.appendChild(option.cloneNode(true));
      });
      if (state.categories.includes('General')) category.value = 'General';
      if (previousFilter && state.categories.includes(previousFilter)) filter.value = previousFilter;
    }

    function clearImageUrls() {
      state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
      state.imageUrls = [];
    }

    function appendEntryImage(container, entry) {
      if (!entry.image) return;
      const image = document.createElement('img');
      image.alt = entry.image.name || 'board image';
      image.loading = 'lazy';
      container.appendChild(image);
      fetchBoardImageBlob(entry)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          state.imageUrls.push(url);
          image.src = url;
        })
        .catch((error) => {
          image.remove();
          const failed = document.createElement('span');
          failed.className = 'board-image-error';
          failed.textContent = error.message || 'Image preview failed.';
          container.appendChild(failed);
        });
    }

    function appendPostContents(container, post, includeOpen = false) {
      const meta = document.createElement('div');
      meta.className = 'board-post-meta';
      const replies = Number(post.reply_count || 0);
      const replyLabel = replies === 1 ? '1 reply' : `${replies} replies`;
      meta.textContent = `${post.category || 'General'} / ${post.display_name || post.username || 'user'} / ${formatDate(post.created_at)} / ${replyLabel}`;
      container.appendChild(meta);
      if (post.text) {
        const body = document.createElement('p');
        body.textContent = post.text;
        container.appendChild(body);
      }
      appendEntryImage(container, post);
      if (includeOpen) {
        const open = document.createElement('button');
        open.className = 'board-open-thread';
        open.type = 'button';
        open.textContent = replies ? 'Open' : 'Reply';
        open.addEventListener('click', () => openThread(post.post_id));
        container.appendChild(open);
      }
    }

    function renderReplies(replies) {
      const rows = Array.isArray(replies) ? replies : [];
      replyList.innerHTML = '';
      if (!rows.length) {
        const item = document.createElement('li');
        item.textContent = 'No replies yet.';
        replyList.appendChild(item);
        return;
      }
      rows.forEach((reply) => {
        const item = document.createElement('li');
        const meta = document.createElement('div');
        meta.className = 'board-post-meta';
        meta.textContent = `${reply.display_name || reply.username || 'user'} / ${formatDate(reply.created_at)}`;
        item.appendChild(meta);
        if (reply.text) {
          const body = document.createElement('p');
          body.textContent = reply.text;
          item.appendChild(body);
        }
        appendEntryImage(item, reply);
        replyList.appendChild(item);
      });
    }

    function showThreadView(show) {
      widget.classList.toggle('is-thread-open', Boolean(show));
      thread.hidden = !show;
      if (!show) state.activePostId = '';
    }

    function renderPosts(posts) {
      state.posts = Array.isArray(posts) ? posts : [];
      clearImageUrls();
      list.innerHTML = '';
      if (!state.posts.length) {
        const item = document.createElement('li');
        item.textContent = 'No board messages yet.';
        list.appendChild(item);
        return;
      }
      state.posts.forEach((post) => {
        const item = document.createElement('li');
        appendPostContents(item, post, true);
        list.appendChild(item);
      });
    }

    function renderImages(files) {
      state.images = Array.isArray(files) ? files : [];
      const current = imageSelect.value;
      const currentReply = replyImageSelect ? replyImageSelect.value : '';
      imageSelect.innerHTML = '<option value="">No image attached</option>';
      if (replyImageSelect) replyImageSelect.innerHTML = '<option value="">No image attached</option>';
      state.images.forEach((file) => {
        const option = document.createElement('option');
        option.value = file.file_id;
        option.textContent = `${file.name || file.stored_name} (${formatBytes(file.size)})`;
        imageSelect.appendChild(option);
        if (replyImageSelect) replyImageSelect.appendChild(option.cloneNode(true));
      });
      if (current && state.images.some((file) => file.file_id === current)) imageSelect.value = current;
      if (replyImageSelect && currentReply && state.images.some((file) => file.file_id === currentReply)) replyImageSelect.value = currentReply;
    }

    async function refreshCategories() {
      const data = await api('/api/board/categories');
      fillCategories(data.categories || []);
    }

    async function refreshImages() {
      const data = await api('/api/board/images');
      renderImages(data.files || []);
      setStatus(state.images.length ? `${state.images.length} WebP images` : 'no WebP images');
    }

    function refreshImagesQuietly() {
      refreshImages().catch((error) => setStatus(error.message || 'images failed', true));
    }

    async function refreshBoard() {
      const query = filter.value ? `?category=${encodeURIComponent(filter.value)}` : '';
      const data = await api(`/api/board/posts${query}`);
      if (data.categories) fillCategories(data.categories);
      renderPosts(data.posts || []);
      setStatus(`${state.posts.length} messages`);
    }

    async function submitPost() {
      const body = text.value.trim();
      const imageFileId = imageSelect.value || state.cameraFileId || '';
      if (!body && !imageFileId) {
        setStatus('write or attach first', true);
        return;
      }
      postButton.disabled = true;
      setStatus('posting...');
      try {
        await api('/api/board/posts', {
          method: 'POST',
          body: JSON.stringify({
            category: category.value || 'General',
            text: body,
            image_file_id: imageFileId
          })
        });
        text.value = '';
        state.cameraFileId = '';
        imageSelect.value = '';
        await refreshBoard();
        setStatus('posted');
      } catch (error) {
        setStatus(error.message || 'post failed', true);
      } finally {
        postButton.disabled = false;
      }
    }

    async function openThread(postId) {
      state.activePostId = postId || '';
      showThreadView(true);
      if (threadStatus) threadStatus.textContent = 'loading...';
      if (threadRoot) threadRoot.innerHTML = '';
      replyList.innerHTML = '';
      try {
        const data = await api(`/api/board/thread?post_id=${encodeURIComponent(state.activePostId)}`);
        if (threadRoot) {
          threadRoot.innerHTML = '';
          appendPostContents(threadRoot, data.post || {}, false);
        }
        renderReplies(data.replies || []);
        if (threadStatus) {
          const count = Array.isArray(data.replies) ? data.replies.length : 0;
          threadStatus.textContent = count === 1 ? '1 reply' : `${count} replies`;
        }
      } catch (error) {
        if (threadStatus) threadStatus.textContent = error.message || 'thread failed';
      }
    }

    async function submitReply() {
      if (!state.activePostId) return;
      const body = replyText.value.trim();
      const imageFileId = replyImageSelect ? replyImageSelect.value : '';
      if (!body && !imageFileId) {
        if (threadStatus) threadStatus.textContent = 'write or attach first';
        return;
      }
      if (replyButton) replyButton.disabled = true;
      if (threadStatus) threadStatus.textContent = 'replying...';
      try {
        const postId = state.activePostId;
        await api('/api/board/replies', {
          method: 'POST',
          body: JSON.stringify({
            post_id: postId,
            text: body,
            image_file_id: imageFileId
          })
        });
        replyText.value = '';
        if (replyImageSelect) replyImageSelect.value = '';
        await refreshBoard();
        await openThread(postId);
      } catch (error) {
        if (threadStatus) threadStatus.textContent = error.message || 'reply failed';
      } finally {
        if (replyButton) replyButton.disabled = false;
      }
    }

    toggle.addEventListener('click', () => setOpen(widget.classList.contains('is-collapsed')));
    refresh?.addEventListener('click', () => refreshBoard().catch((error) => setStatus(error.message || 'refresh failed', true)));
    imageRefresh?.addEventListener('click', refreshImagesQuietly);
    opacityInput?.addEventListener('input', () => applyOpacity(opacityInput.value));
    filter.addEventListener('change', () => refreshBoard().catch((error) => setStatus(error.message || 'filter failed', true)));
    imageSelect?.addEventListener('focus', refreshImagesQuietly);
    imageSelect?.addEventListener('pointerdown', refreshImagesQuietly);
    replyImageSelect?.addEventListener('focus', refreshImagesQuietly);
    replyImageSelect?.addEventListener('pointerdown', refreshImagesQuietly);
    window.addEventListener('digitalcpu:id-files-changed', refreshImagesQuietly);
    window.addEventListener('storage', (event) => {
      if (event.key === sessionKey) refreshImagesQuietly();
    });
    window.addEventListener('focus', () => {
      if (!widget.classList.contains('is-collapsed')) refreshImagesQuietly();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitPost();
    });
    threadBack?.addEventListener('click', () => showThreadView(false));
    replyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitReply();
    });

    cameraButton?.addEventListener('click', () => cameraInput?.click());
    cameraInput?.addEventListener('change', async () => {
      const file = cameraInput.files && cameraInput.files[0];
      if (!file) return;
      setStatus('camera upload...');
      try {
        const result = await uploadFileChunked(file, 'board', setStatus);
        state.cameraFileId = result.file && result.file.file_id ? result.file.file_id : '';
        await refreshImages();
        imageSelect.value = state.cameraFileId;
        setStatus('camera image ready');
      } catch (error) {
        setStatus(error.message || 'camera failed', true);
      } finally {
        cameraInput.value = '';
      }
    });

    refreshCategories()
      .then(refreshImages)
      .then(refreshBoard)
      .catch((error) => {
        fillCategories(fallbackCategories);
        setStatus(error.message || 'board offline', true);
      });
    applyOpacity(localStorage.getItem(opacityKey) || (opacityInput && opacityInput.value) || 84);
    setOpen(localStorage.getItem(panelStateKey) === '1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
