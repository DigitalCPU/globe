(function (GP) {
  const Profiles = GP.Profiles = GP.Profiles || {};
  GP.showProfile = async function (username = GP.state.account?.username, publicView = false) {
    if (!username) { GP.write('Use profile <username> to view a public profile.'); return; }
    const target = Profiles.panel('Profile');
    const status = Profiles.node('div', 'loading...', 'hint'); target.append(status);
    try {
      const {profile} = await GP.api(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!target.isConnected) return;
      status.textContent = '';
      const own = !publicView && GP.state.account?.username.toLowerCase() === profile.username.toLowerCase();
      const info = Profiles.node('div', '', 'profile-info');
      if (profile.has_avatar) {
        const image = Profiles.node('img', '', 'profile-avatar'); image.src = Profiles.avatarUrl(profile);
        image.alt = `${profile.display_name}'s avatar`; info.append(image);
      }
      const details = Profiles.node('div');
      details.append(Profiles.node('h3', profile.display_name), Profiles.node('div', `@${profile.username}`, 'hint'));
      for (const [key, label] of [['bio','About'],['location','Location'],['interests','Interests']]) {
        if (profile[key]) details.append(Profiles.node('p', `${label}: ${profile[key]}`));
      }
      info.append(details); target.append(info);
      if (own) {
        const header = target.querySelector('.profile-header');
        header.insertBefore(Profiles.button('edit profile', () => GP.editProfile()), header.lastElementChild);
      }
      target.append(Profiles.connectionsSection(profile, false, publicView));
      target.append(Profiles.node('h3', 'Personal board'));
      if (own) {
        const form = Profiles.node('form', '', 'profile-form');
        const input = Profiles.node('textarea'); input.maxLength = 2000; input.rows = 3;
        input.placeholder = 'Write a public post'; input.setAttribute('aria-label','Public board post');
        let attachmentId = '', uploading = false;
        const attachmentStatus = Profiles.node('div', '', 'hint');
        attachmentStatus.setAttribute('role', 'status');
        const picker = Profiles.node('input'); picker.type = 'file'; picker.hidden = true;
        const cameraPicker = Profiles.node('input'); cameraPicker.type = 'file'; cameraPicker.hidden = true;
        cameraPicker.accept = 'image/*'; cameraPicker.setAttribute('capture', 'environment');
        const upload = Profiles.button('upload', () => { picker.value = ''; picker.click(); });
        const camera = Profiles.button('camera', () => { cameraPicker.value = ''; cameraPicker.click(); });
        const select = Profiles.node('select'); select.hidden = true;
        select.setAttribute('aria-label', 'Personal board attachment from MyDatabase');
        const database = Profiles.button('MyDatabase', async () => {
          if (!select.hidden) { select.hidden = true; return; }
          database.disabled = send.disabled = true;
          try {
            const {files = []} = await GP.api('/api/id/files');
            if (!target.isConnected) return;
            select.replaceChildren();
            const empty = Profiles.node('option', files.length ? 'Choose a file' : 'No files available'); empty.value = ''; select.append(empty);
            for (const file of files) {
              const option = Profiles.node('option', GP.fileName(file)); option.value = file.file_id; select.append(option);
            }
            select.hidden = false; select.focus();
          } catch (error) { attachmentStatus.textContent = error.message; }
          finally { database.disabled = false; send.disabled = uploading; }
        });
        function chooseAttachment(id, name) {
          attachmentId = id;
          attachmentStatus.textContent = `${name} - publish to make this attachment public.`;
          remove.hidden = false;
        }
        select.addEventListener('change', () => {
          if (!select.value || uploading) return;
          chooseAttachment(select.value, select.selectedOptions[0].textContent);
          select.hidden = true;
        });
        const remove = Profiles.button('remove attachment', () => { attachmentId = ''; attachmentStatus.textContent = ''; remove.hidden = true; });
        remove.hidden = true;
        const send = Profiles.node('Profiles.button','publish'); send.type = 'submit';
        async function attachUpload(file) {
          if (!file || uploading || !GP.requireAccount()) return;
          uploading = true; upload.disabled = camera.disabled = database.disabled = select.disabled = send.disabled = remove.disabled = true;
          attachmentStatus.textContent = 'Uploading...';
          try {
            const result = await GP.uploadFile(file, 'profile');
            chooseAttachment(result.file.file_id, GP.fileName(result.file));
          } catch (error) { attachmentStatus.textContent = error.message; }
          finally { uploading = false; upload.disabled = camera.disabled = database.disabled = select.disabled = send.disabled = remove.disabled = false; }
        }
        picker.addEventListener('change', () => void attachUpload(picker.files[0]));
        cameraPicker.addEventListener('change', () => void attachUpload(cameraPicker.files[0]));
        const actions = Profiles.node('div', '', 'profile-actions personal-board-actions');
        send.className = 'profile-publish';
        actions.append(upload, database, camera, send);
        form.append(input, picker, cameraPicker, actions, select, attachmentStatus, remove);
        form.addEventListener('keydown', event => event.stopPropagation());
        form.addEventListener('submit', async event => {
          event.preventDefault(); event.stopPropagation();
          if (!GP.requireAccount() || (!input.value.trim() && !attachmentId) || send.disabled || uploading) return;
          send.disabled = true;
          try {
            await GP.api('/api/profile/posts', {method:'POST',body:JSON.stringify({text:input.value, file_id:attachmentId})});
            await GP.showProfile(username);
          } catch(error) { status.textContent = error.message; send.disabled = false; }
        });
        target.append(form);
      }
      const boardPosts = Profiles.node('div', '', own ? 'personal-board-posts' : 'personal-board-posts public-board-scroll');
      if (!own) { boardPosts.tabIndex=0; boardPosts.setAttribute('aria-label', 'Personal board posts'); }
      target.append(boardPosts);
      if (!profile.posts.length) boardPosts.append(Profiles.node('div','No posts yet.','hint'));
      for (const post of profile.posts) {
        const entry = Profiles.node('article','', 'profile-post');
        entry.append(Profiles.node('div',new Date(post.created * 1000).toLocaleString(),'hint'), Profiles.node('p',post.text));
        if (post.attachment) {
          const url = `${GP.API_BASE}/api/profile?username=${encodeURIComponent(profile.username)}&attachment=${encodeURIComponent(post.id)}`;
          if (post.attachment.is_image) {
            const image = Profiles.node('img', '', 'profile-post-image');
            image.src = `${url}&preview=1`; image.alt = post.attachment.name; image.loading = 'lazy';
            image.addEventListener('error', () => {
              image.replaceWith(Profiles.node('div', 'Image preview unavailable.', 'hint'));
            }, {once: true});
            entry.append(image);
          }
          const download = Profiles.node('a', `download ${post.attachment.name}`);
          download.href = url; download.download = post.attachment.name;
          entry.append(download);
        }
        if (own) entry.append(Profiles.button('delete post', async () => {
          if (!window.confirm('Delete this post?')) return;
          try {
            await GP.api('/api/profile/posts',{method:'POST',body:JSON.stringify({delete_id:post.id})});
            entry.remove();
          } catch(error) {status.textContent=error.message;}
        }));
        if (own) {
          boardPosts.append(entry);
        } else {
          const thread = Profiles.node('details', '', 'profile-post-thread');
          const summary = Profiles.node('summary', '', 'profile-post-summary');
          const date = Profiles.node('time', new Date(post.created * 1000).toLocaleString(), 'hint');
          date.dateTime = new Date(post.created * 1000).toISOString();
          summary.append(date);
          if (post.attachment?.is_image) {
            const thumbnail = Profiles.node('img', '', 'profile-post-thumb');
            thumbnail.src = `${GP.API_BASE}/api/profile?username=${encodeURIComponent(profile.username)}&attachment=${encodeURIComponent(post.id)}&preview=1`;
            thumbnail.alt = post.attachment.name; thumbnail.loading = 'lazy';
            thumbnail.addEventListener('error', () => thumbnail.replaceWith(Profiles.node('span', 'Image unavailable', 'hint')), {once:true});
            summary.append(thumbnail);
          } else {
            const words = (post.text || post.attachment?.name || '').trim().split(/\s+/);
            summary.append(Profiles.node('span', words.slice(0,12).join(' ') + (words.length > 12 ? '...' : '')));
          }
          entry.classList.add('profile-post-expanded');
          entry.tabIndex=0; entry.setAttribute('aria-label','Opened personal board post');
          thread.append(summary, entry); boardPosts.append(thread);
        }
      }
    } catch(error) {status.textContent=error.message;}
  };
})(window.GhostProtocol);
