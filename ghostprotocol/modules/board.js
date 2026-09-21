(function (GP) {
  function clearBoardElement() {
    if (GP.state.boardElement) GP.state.boardElement.remove();
    GP.state.boardElement = null;
    GP.state.boardHeaderActive = false;
  }

  GP.renderBoardHeader = function () {
    if (!GP.state.boardHeaderActive || !GP.state.boardElement?.isConnected) return false;
    const hint = GP.dom.terminalHint;
    if (!hint) return false;
    hint.replaceChildren();
    const header = document.createElement('nav');
    header.className = 'board-panel-header board-header-links';
    header.setAttribute('aria-label', 'Message board controls');
    header.appendChild(document.createTextNode('Message board'));
    if (GP.state.account) header.appendChild(GP.inlineButton('post', () => postBoardMessage()));
    header.appendChild(GP.inlineButton('refresh', () => refreshBoardPanel().catch(error => GP.write(error.message, 'error'))));
    header.appendChild(GP.inlineButton('close board', () => closeBoard()));
    hint.appendChild(header);
    return true;
  };

  function boardSummary(post) {
    const name = post.display_name || post.username || 'user';
    const fullText = post.text || '[file]';
    const conversation = fullText.split(/\bconversation:\s*/i).pop().replace(/^user:\s*/i, '');
    const words = conversation.trim().split(/\s+/);
    const text = words.slice(0, 16).join(' ') + (words.length > 16 ? '...' : '');
    const replies = Number(post.reply_count || 0);
    const replyText = replies === 1 ? '1 reply' : `${replies} replies`;
    return `${name}: ${text} (${replyText})`;
  }

  async function refreshBoardPanel() {
    if (!GP.state.boardElement) return;
    const list = GP.state.boardElement.querySelector('.board-panel-list');
    list.textContent = 'loading board...';
    const data = await GP.api('/api/board/posts?limit=80');
    if (!list.isConnected) return;
    GP.state.posts = data.posts || [];
    list.innerHTML = '';
    if (!GP.state.posts.length) {
      list.textContent = 'no board messages yet';
      GP.autoScroll();
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
    GP.autoScroll();
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
      if (GP.isOwner()) {
        root.appendChild(GP.deleteButton('delete thread', () => deleteBoardThread(postId)));
      }
      if (replies.length) {
        replies.forEach((reply) => {
          const replyRow = document.createElement('div');
          replyRow.className = 'board-reply';
          replyRow.textContent = `${reply.display_name || reply.username || 'user'}: ${reply.text || '[file]'}`;
          detail.appendChild(replyRow);
          void GP.fetchBoardImage(reply, replyRow);
          if (GP.isOwner()) {
            replyRow.appendChild(GP.deleteButton('delete reply', () => deleteBoardReply(reply.reply_id, postId)));
          }
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'line hint';
        empty.textContent = 'no replies yet';
        detail.appendChild(empty);
      }
      if (GP.state.account) detail.appendChild(GP.inlineButton('reply', () => replyToBoardThread(postId)));
      detail.appendChild(GP.inlineButton('close thread', () => { detail.remove(); row.setAttribute('aria-expanded', 'false'); }));
      GP.autoScroll();
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

  async function postBoardMessage() {
    if (!GP.requireAccount()) return;
    try {
      const text = await GP.promptLine('new board post, or leave blank to cancel:');
      const key = GP.commandKey(text);
      if (!text.trim()) {
        GP.write('board post canceled');
        return;
      }
      if (key === 'closeboard' || key === 'boardclose') {
        closeBoard();
        return;
      }
      await GP.api('/api/board/posts', {
        method: 'POST',
        body: JSON.stringify({ category: 'General', text })
      });
      GP.write('posted');
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'post failed', 'error');
    }
  }

  async function replyToBoardThread(postId) {
    if (!GP.requireAccount()) return;
    try {
      const text = await GP.promptLine('reply text, or leave blank to cancel:');
      const key = GP.commandKey(text);
      if (!text.trim()) {
        GP.write('reply canceled');
        return;
      }
      if (key === 'closeboard' || key === 'boardclose') {
        closeBoard();
        return;
      }
      await GP.api('/api/board/replies', {
        method: 'POST',
        body: JSON.stringify({ post_id: postId, text })
      });
      GP.write('reply posted');
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'reply failed', 'error');
    }
  }

  async function board(host = GP.dom.screen, actions = null) {
    try {
      if (!actions) {
        GP.closeLobby?.();
        if (GP.state.chatMode) GP.exitChat();
      }
      GP.state.boardOpen = true;
      clearBoardElement();
      const panel = document.createElement('div');
      panel.className = 'board-panel';
      const header = document.createElement('div');
      header.className = 'board-panel-header';
      if (!actions) header.textContent = 'Message board';
      if (GP.state.account) header.appendChild(GP.inlineButton('post', () => postBoardMessage()));
      header.appendChild(GP.inlineButton('refresh', () => refreshBoardPanel().catch((error) => GP.write(error.message, 'error'))));
      if (!actions) header.appendChild(GP.inlineButton('close board', () => closeBoard()));
      if (actions) actions.appendChild(header);
      const list = document.createElement('div');
      list.className = 'board-panel-list';
      panel.appendChild(list);
      host.appendChild(panel);
      GP.state.boardElement = panel;
      GP.state.boardHeaderActive = !actions;
      GP.renderMailHint?.();
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'board unavailable', 'error');
    }
  }

  function closeBoard(silent = false) {
    GP.state.boardOpen = false;
    clearBoardElement();
    GP.renderMailHint?.();
    if (!silent) GP.write('board closed');
  }

  GP.board = board;
  GP.postBoardMessage = postBoardMessage;
  GP.closeBoard = closeBoard;
})(window.GhostProtocol);
