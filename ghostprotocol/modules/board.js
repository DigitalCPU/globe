(function (GP) {
  function clearBoardElement() {
    if (GP.state.boardElement) GP.state.boardElement.remove();
    GP.state.boardElement = null;
  }

  function boardSummary(post) {
    const name = post.display_name || post.username || 'user';
    const text = post.text || '[file]';
    const replies = Number(post.reply_count || 0);
    const replyText = replies === 1 ? '1 reply' : `${replies} replies`;
    return `${name}: ${text} (${replyText})`;
  }

  async function refreshBoardPanel() {
    if (!GP.state.boardElement) return;
    const list = GP.state.boardElement.querySelector('.board-panel-list');
    list.textContent = 'loading board...';
    const data = await GP.api('/api/board/posts?limit=80');
    GP.state.posts = data.posts || [];
    list.innerHTML = '';
    if (!GP.state.posts.length) {
      list.textContent = 'no board messages yet';
      GP.autoScroll();
      return;
    }
    GP.state.posts.forEach((post, index) => {
      const row = document.createElement('button');
      row.className = 'board-row';
      row.type = 'button';
      row.dataset.postId = post.post_id;
      row.textContent = `${index + 1}) ${boardSummary(post)}`;
      row.addEventListener('click', () => openBoardThread(post.post_id, row));
      list.appendChild(row);
    });
    GP.autoScroll();
  }

  async function openBoardThread(postId, row) {
    if (!postId) return;
    const existing = GP.state.boardElement && GP.state.boardElement.querySelector('.board-thread-detail');
    if (existing) existing.remove();
    const detail = document.createElement('div');
    detail.className = 'board-thread-detail';
    detail.textContent = 'opening thread...';
    row.insertAdjacentElement('afterend', detail);
    try {
      const data = await GP.api(`/api/board/thread?post_id=${encodeURIComponent(postId)}`);
      const post = data.post || {};
      const replies = Array.isArray(data.replies) ? data.replies : [];
      detail.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'board-thread-root';
      root.textContent = `${post.display_name || post.username || 'user'}: ${post.text || '[file]'}`;
      detail.appendChild(root);
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
      detail.appendChild(GP.inlineButton('reply', () => replyToBoardThread(postId)));
      detail.appendChild(GP.inlineButton('close thread', () => detail.remove()));
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

  async function board() {
    if (!GP.requireAccount()) return;
    try {
      GP.state.boardOpen = true;
      clearBoardElement();
      const panel = document.createElement('div');
      panel.className = 'board-panel';
      const header = document.createElement('div');
      header.className = 'board-panel-header';
      header.textContent = 'Message board';
      header.appendChild(GP.inlineButton('post', () => postBoardMessage()));
      header.appendChild(GP.inlineButton('refresh', () => refreshBoardPanel().catch((error) => GP.write(error.message, 'error'))));
      header.appendChild(GP.inlineButton('close board', () => closeBoard()));
      panel.appendChild(header);
      const list = document.createElement('div');
      list.className = 'board-panel-list';
      panel.appendChild(list);
      GP.dom.screen.appendChild(panel);
      GP.state.boardElement = panel;
      await refreshBoardPanel();
    } catch (error) {
      GP.write(error.message || 'board unavailable', 'error');
    }
  }

  function closeBoard() {
    GP.state.boardOpen = false;
    clearBoardElement();
    GP.write('board closed');
  }

  GP.board = board;
  GP.postBoardMessage = postBoardMessage;
  GP.closeBoard = closeBoard;
})(window.GhostProtocol);
