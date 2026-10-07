(function (GP) {
  const CATEGORY_LABELS = {
    News: 'news',
    Media: 'media',
    Games: 'games',
    Animals: 'animals',
    Social: 'social',
    Lobby: 'lobby',
    Updates: 'updates',
    Music: 'music'
  };

  function boardCategories() {
    return GP.state.boardCategories?.length
      ? GP.state.boardCategories
      : ['News', 'Media', 'Games', 'Animals', 'Social', 'Lobby', 'Updates', 'Music'];
  }

  function boardCategory() {
    return GP.state.boardCategory || 'Lobby';
  }

  function canPostCategory(category = boardCategory()) {
    if (!GP.state.account) return false;
    if (category !== 'Updates') return true;
    return ['admin', 'owner'].includes(String(GP.state.account.role || '').toLowerCase());
  }

  function clearBoardElement() {
    if (GP.state.boardElement) GP.state.boardElement.remove();
    GP.state.boardElement = null;
    GP.state.boardHeaderActive = false;
    GP.state.boardHeaderHost = null;
  }

  function renderCategoryLinks(target) {
    const bar = document.createElement('div');
    bar.className = 'board-category-bar';
    bar.setAttribute('aria-label', 'Message board categories');
    boardCategories().forEach((category) => {
      const button = GP.inlineButton(CATEGORY_LABELS[category] || category.toLowerCase(), () => selectBoardCategory(category));
      button.classList.toggle('active', category === boardCategory());
      button.setAttribute('aria-current', category === boardCategory() ? 'page' : 'false');
      bar.appendChild(button);
    });
    target.appendChild(bar);
  }

  GP.renderBoardHeader = function () {
    if (!GP.state.boardElement?.isConnected) return false;
    const hint = GP.state.boardHeaderHost || (GP.state.boardHeaderActive ? GP.dom.terminalHint : null);
    if (!hint) return false;
    hint.replaceChildren();
    const header = document.createElement('nav');
    header.className = 'board-panel-header board-header-links';
    header.setAttribute('aria-label', 'Message board controls');
    const left = document.createElement('span');
    left.className = 'board-header-left';
    if (canPostCategory()) left.appendChild(GP.inlineButton('post', () => postBoardMessage()));
    renderCategoryLinks(left);
    const right = document.createElement('span');
    right.className = 'board-header-right';
    right.appendChild(GP.inlineButton('refresh', () => refreshBoardPanel().catch(error => GP.write(error.message, 'error'))));
    right.appendChild(GP.inlineButton('close message board', () => closeBoard()));
    header.append(left, right);
    hint.appendChild(header);
    return true;
  };

  function boardSummary(post) {
    const name = post.display_name || post.username || 'user';
    const fullText = post.text || '[file]';
    const conversation = fullText.split(/\bconversation:\s*/i).pop().replace(/^user:\s*/i, '');
    const words = conversation.trim().split(/\s+/).filter(Boolean);
    const text = words.slice(0, 16).join(' ') + (words.length > 16 ? '...' : '');
    const replies = Number(post.reply_count || 0);
    const replyText = replies === 1 ? '1 reply' : `${replies} replies`;
    return `${name}: ${text || '[file]'} (${replyText})`;
  }

  function scrollThreadIntoView(row) {
    const target = row.closest('.board-post') || row;
    if (target.scrollIntoView) {
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
      return;
    }
    GP.dom.screen.scrollTop = Math.max(0, target.offsetTop - GP.dom.screen.offsetTop);
  }

  function postTime(post) {
    const value = Date.parse(post?.created_at || post?.updated_at || '');
    return Number.isFinite(value) ? value : 0;
  }

  function scrollBoardTop() {
    requestAnimationFrame(() => {
      const target = GP.state.boardElement?.querySelector('.board-post') || GP.state.boardElement;
      if (target?.scrollIntoView) target.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
  }

  async function loadCategories() {
    try {
      const data = await GP.api('/api/board/categories');
      if (Array.isArray(data.categories) && data.categories.length) GP.state.boardCategories = data.categories;
    } catch (_error) {
      GP.state.boardCategories = boardCategories();
    }
  }

  async function selectBoardCategory(category) {
    GP.state.boardCategory = category;
    GP.cancelPrompt?.('board');
    const list = GP.state.boardElement?.querySelector('.board-panel-list');
    if (list) list.textContent = `opening ${CATEGORY_LABELS[category] || category.toLowerCase()} board...`;
    GP.renderBoardHeader?.();
    await refreshBoardPanel();
  }

  async function refreshBoardPanel() {
    if (!GP.state.boardElement) return;
    const list = GP.state.boardElement.querySelector('.board-panel-list');
    list.textContent = 'loading board...';
    const category = boardCategory();
    const data = await GP.api(`/api/board/posts?limit=80&category=${encodeURIComponent(category)}`);
    if (!list.isConnected) return;
    if (Array.isArray(data.categories) && data.categories.length) GP.state.boardCategories = data.categories;
    GP.state.posts = [...(data.posts || [])].sort((a, b) => postTime(b) - postTime(a));
    list.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'board-category-title';
    title.textContent = `${CATEGORY_LABELS[category] || category.toLowerCase()} board`;
    list.appendChild(title);
    if (!canPostCategory(category) && category === 'Updates') {
      const note = document.createElement('div');
      note.className = 'hint';
      note.textContent = 'updates are view only unless your account is admin or owner';
      list.appendChild(note);
    }
    if (!GP.state.posts.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'no board messages yet';
      list.appendChild(empty);
      scrollBoardTop();
      return;
    }
    GP.state.posts.forEach((post, index) => {
      const card = document.createElement('article');
      card.className = 'board-post';
      const row = document.createElement('button');
      row.className = 'board-row';
      row.type = 'button';
      row.dataset.postId = post.post_id;
      const summary = document.createElement('span');
      summary.textContent = `${index + 1}) ${boardSummary(post)}`;
      row.appendChild(summary);
      row.setAttribute('aria-expanded', 'false');
      row.addEventListener('click', () => openBoardThread(post.post_id, row));
      card.appendChild(row);
      list.appendChild(card);
      void GP.fetchBoardImage(post, row);
    });
    scrollBoardTop();
  }

  async function openBoardThread(postId, row) {
    if (!postId) return;
    const existing = GP.state.boardElement && GP.state.boardElement.querySelector('.board-thread-detail');
    const wasOpen = row.getAttribute('aria-expanded') === 'true';
    if (existing) existing.remove();
    GP.state.boardElement?.querySelectorAll('.board-row').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (wasOpen) return;
    row.setAttribute('aria-expanded', 'true');
    const detail = document.createElement('div');
    detail.className = 'board-thread-detail';
    detail.textContent = 'opening thread...';
    row.insertAdjacentElement('afterend', detail);
    try {
      const data = await GP.api(`/api/board/thread?post_id=${encodeURIComponent(postId)}`);
      if (!detail.isConnected) return;
      const post = data.post || {};
      const replies = Array.isArray(data.replies) ? data.replies : [];
      detail.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'board-thread-root';
      root.textContent = `${post.display_name || post.username || 'user'}: ${post.text || '[file]'}`;
      detail.appendChild(root);
      if (post.username) root.appendChild(GP.inlineButton('view profile', () => GP.showProfile(post.username)));
      await GP.fetchBoardImage(post, root);
      if (GP.isOwner()) root.appendChild(GP.deleteButton('delete thread', () => deleteBoardThread(postId)));
      if (replies.length) {
        replies.forEach((reply) => {
          const replyRow = document.createElement('div');
          replyRow.className = 'board-reply';
          replyRow.textContent = `${reply.display_name || reply.username || 'user'}: ${reply.text || '[file]'}`;
          detail.appendChild(replyRow);
          void GP.fetchBoardImage(reply, replyRow);
          if (GP.isOwner()) replyRow.appendChild(GP.deleteButton('delete reply', () => deleteBoardReply(reply.reply_id, postId)));
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'line hint';
        empty.textContent = 'no replies yet';
        detail.appendChild(empty);
      }
      if (GP.state.account) detail.appendChild(GP.inlineButton('reply', () => replyToBoardThread(postId)));
      detail.appendChild(GP.inlineButton('close thread', () => { detail.remove(); row.setAttribute('aria-expanded', 'false'); }));
      requestAnimationFrame(() => scrollThreadIntoView(row));
    } catch (error) {
      detail.textContent = error.message || 'thread unavailable';
      detail.classList.add('error');
    }
  }

  async function deleteBoardThread(postId) {
    if (!GP.isOwner() || !postId) return;
    if (!window.confirm('Delete this board thread and its replies?')) return;
    try {
      await GP.api('/api/board/posts/delete', {
        method: 'POST',
        body: JSON.stringify({ post_id: postId })
      });
      GP.write('thread deleted');
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'delete failed', 'error');
    }
  }

  async function deleteBoardReply(replyId, postId) {
    if (!GP.isOwner() || !replyId) return;
    if (!window.confirm('Delete this reply?')) return;
    try {
      await GP.api('/api/board/replies/delete', {
        method: 'POST',
        body: JSON.stringify({ reply_id: replyId })
      });
      GP.write('reply deleted');
      await refreshBoardPanel();
      const postRow = GP.state.boardElement?.querySelector(`.board-row[data-post-id="${postId}"]`);
      if (postRow) await openBoardThread(postId, postRow);
    } catch (error) {
      GP.write(error.message || 'delete failed', 'error');
    }
  }

  async function loadBoardImages(target, onSelect) {
    target.textContent = 'loading mydocuments images...';
    const data = await GP.api('/api/board/images');
    target.innerHTML = '';
    const files = data.files || [];
    if (!files.length) {
      target.textContent = 'no board-ready images in MyDatabase';
      return;
    }
    files.forEach((file, index) => {
      const button = GP.inlineButton(`${index + 1}) ${file.original_name || file.stored_name || file.name}`, () => onSelect(file));
      target.appendChild(button);
    });
  }

  function createBoardComposer({ postId = '' } = {}) {
    if (!GP.requireAccount()) return null;
    const category = boardCategory();
    if (!postId && !canPostCategory(category)) {
      GP.write('updates are view only unless your account is admin or owner', 'error');
      return null;
    }
    GP.cancelPrompt?.('board');
    const list = GP.state.boardElement?.querySelector('.board-panel-list');
    if (!list) return null;
    const existing = GP.state.boardElement.querySelector('.board-composer');
    if (existing) existing.remove();
    const composer = document.createElement('section');
    composer.className = 'board-composer';
    const title = document.createElement('div');
    title.className = 'hint';
    title.textContent = postId ? 'reply' : `post to ${CATEGORY_LABELS[category] || category.toLowerCase()}`;
    const input = document.createElement('textarea');
    input.rows = 3;
    input.maxLength = 1000;
    input.placeholder = postId ? 'reply text...' : 'post text...';
    input.setAttribute('aria-label', title.textContent);
    const status = document.createElement('div');
    status.className = 'hint';
    const picker = document.createElement('div');
    picker.className = 'board-image-picker';
    let imageFile = null;
    const mydocuments = GP.inlineButton('mydocuments', () => {
      loadBoardImages(picker, (file) => {
        imageFile = file;
        status.textContent = `attached: ${file.original_name || file.stored_name || file.name}`;
        picker.replaceChildren(GP.inlineButton('remove image', () => {
          imageFile = null;
          status.textContent = '';
          picker.replaceChildren();
        }));
      }).catch((error) => {
        picker.textContent = error.message || 'mydocuments unavailable';
        picker.classList.add('error');
      });
    });
    const send = GP.inlineButton(postId ? 'send reply' : 'post', async () => {
      const text = input.value.trim();
      if (!text && !imageFile) {
        status.textContent = 'write text or attach an image';
        return;
      }
      send.disabled = true;
      try {
        if (postId) {
          await GP.api('/api/board/replies', {
            method: 'POST',
            body: JSON.stringify({ post_id: postId, text, image_file_id: imageFile?.file_id || '' })
          });
          GP.write('reply posted');
        } else {
          await GP.api('/api/board/posts', {
            method: 'POST',
            body: JSON.stringify({ category, text, image_file_id: imageFile?.file_id || '' })
          });
          GP.write('posted');
        }
        composer.remove();
        await refreshBoardPanel();
        if (postId) {
          const postRow = GP.state.boardElement?.querySelector(`.board-row[data-post-id="${postId}"]`);
          if (postRow) await openBoardThread(postId, postRow);
        }
      } catch (error) {
        status.textContent = error.message || 'post failed';
        status.classList.add('error');
        send.disabled = false;
      }
    });
    const cancel = GP.inlineButton('cancel', () => composer.remove());
    composer.append(title, input, document.createElement('br'), mydocuments, send, cancel, status, picker);
    list.insertAdjacentElement('afterbegin', composer);
    input.focus();
    return composer;
  }

  async function postBoardMessage() {
    createBoardComposer();
  }

  async function replyToBoardThread(postId) {
    createBoardComposer({ postId });
  }

  async function board(host = GP.dom.screen, actions = null) {
    try {
      if (!actions) {
        GP.closeLobby?.();
        if (GP.state.chatMode) GP.exitChat();
        GP.setStatusSuffix('/ Message Board Open');
      }
      GP.state.boardOpen = true;
      GP.state.boardCategory = GP.state.boardCategory || 'Lobby';
      await loadCategories();
      clearBoardElement();
      const panel = document.createElement('div');
      panel.className = 'board-panel';
      const header = document.createElement('div');
      header.className = 'board-panel-header board-header-links';
      const left = document.createElement('span');
      left.className = 'board-header-left';
      if (canPostCategory()) left.appendChild(GP.inlineButton('post', () => postBoardMessage()));
      renderCategoryLinks(left);
      const right = document.createElement('span');
      right.className = 'board-header-right';
      right.appendChild(GP.inlineButton('refresh', () => refreshBoardPanel().catch((error) => GP.write(error.message, 'error'))));
      if (!actions) right.appendChild(GP.inlineButton('close message board', () => closeBoard()));
      header.append(left, right);
      if (actions) actions.appendChild(header);
      else panel.appendChild(header);
      const list = document.createElement('div');
      list.className = 'board-panel-list';
      panel.appendChild(list);
      host.appendChild(panel);
      GP.state.boardElement = panel;
      GP.state.boardHeaderActive = !actions;
      GP.state.boardHeaderHost = actions || null;
      GP.renderMailHint?.();
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'board unavailable', 'error');
    }
  }

  function closeBoard(silent = false) {
    GP.cancelPrompt?.('board');
    GP.state.boardOpen = false;
    clearBoardElement();
    if (!GP.state.lobbyOpen) GP.setStatusSuffix('');
    GP.renderMailHint?.();
    if (!silent) GP.write('board closed');
  }

  GP.board = board;
  GP.postBoardMessage = postBoardMessage;
  GP.closeBoard = closeBoard;
})(window.GhostProtocol);
