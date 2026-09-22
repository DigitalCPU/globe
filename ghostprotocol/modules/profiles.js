(function (GP) {
  let current = null;
  const avatarUrl = profile => `${GP.API_BASE}/api/profile/avatar?username=${encodeURIComponent(profile.username)}&fx=1&v=${encodeURIComponent(profile.updated)}`;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action) {
    const element = node('button', text); element.type = 'button';
    element.addEventListener('click', action); return element;
  }
  GP.updateConnection = async function (command) {
    if (!GP.requireAccount()) return null;
    const match = String(command).trim().match(/^(.+?)\s+(add|remove)$/i);
    if (!match) throw new Error('Enter a username followed by add or remove.');
    const {profile} = await GP.api('/api/profile', {method:'POST', body:JSON.stringify({
      action:`connection-${match[2].toLowerCase()}`, username:match[1].trim()
    })});
    return profile;
  };
  GP.connectionCommand = async function (command) {
    try {
      const profile = await GP.updateConnection(command);
      if (profile) { GP.write('Connections updated.'); await GP.showProfile(profile.username); }
    } catch (error) { GP.write(error.message, 'error'); }
  };
  function connectionsSection(profile, editable=false, publicView=false) {
    const own=!publicView && GP.state.account?.username.toLowerCase()===profile.username.toLowerCase();
    const section=node(own ? 'section' : 'details','', 'profile-connections');
    const heading=node(own ? 'h3' : 'summary','Connections');
    const list=node('div','', 'connection-list');
    if (!own) { list.classList.add('connection-strip'); list.tabIndex=0; list.setAttribute('aria-label','Connections'); }
    const status=node('div','', 'hint'); status.setAttribute('role','status');
    function render(next) {
      profile=next; list.replaceChildren();
      const entries=profile.connections || [];
      if (profile.connections_visible === false && !own) { section.hidden=true; return; }
      section.hidden=false;
      if (!entries.length) list.append(node('span','No connections yet.','hint'));
      for (const user of entries) {
        const link=button('',()=>GP.showProfile(user.username)); link.className='connection-link';
        const square=node('span','', 'connection-avatar');
        if(user.has_avatar) {
          const image=node('img'); image.src=avatarUrl(user); image.alt=''; image.loading='lazy';
          image.addEventListener('error',()=>image.remove(),{once:true}); square.append(image);
        }
        link.append(square,node('span',user.username)); list.append(link);
      }
    }
    section.append(heading);
    if(editable) {
      const label=node('label','', 'connections-visibility');
      const toggle=node('input'); toggle.type='checkbox'; toggle.checked=profile.connections_visible !== false;
      label.append(toggle,document.createTextNode('Show connections on my profile'));
      toggle.addEventListener('change',async()=>{
        const before=profile.connections_visible !== false;
        toggle.disabled=true;
        try {
          const result=await GP.api('/api/profile',{method:'POST',body:JSON.stringify({action:'connection-visibility',visible:toggle.checked})});
          render(result.profile); status.textContent=toggle.checked?'Connections are public.':'Connections are hidden from other viewers.';
        } catch(error) {toggle.checked=before;status.textContent=error.message;}
        finally {toggle.disabled=false;}
      });
      const form=node('form','', 'connection-command');
      const input=node('input'); input.setAttribute('aria-label','Connection command'); input.placeholder='username add / username remove'; input.maxLength=270;
      const submit=node('button','submit'); submit.type='submit'; form.append(input,submit);
      form.addEventListener('keydown',event=>event.stopPropagation());
      form.addEventListener('submit',async event=>{
        event.preventDefault();event.stopPropagation();if(submit.disabled)return;
        submit.disabled=true;
        try {
          const updated=await GP.updateConnection(input.value);
          if(updated) {render(updated);input.value='';status.textContent='Connections updated.';}
        }catch(error){status.textContent=error.message;}
        finally{submit.disabled=false;}
      });
      section.append(label,form);
    }
    section.append(list,status);render(profile);return section;
  }
  function panel(title) {
    if (current) current.remove();
    current = node('section', '', 'profile-panel');
    const header = node('div', '', 'profile-header');
    const target = current;
    header.append(node('strong', title), button('close', () => target.remove()));
    current.append(header); GP.dom.screen.append(current); GP.autoScroll();
    return current;
  }
  GP.showProfile = async function (username = GP.state.account?.username, publicView = false) {
    if (!username) { GP.write('Use profile <username> to view a public profile.'); return; }
    const target = panel('Profile');
    const status = node('div', 'loading...', 'hint'); target.append(status);
    try {
      const {profile} = await GP.api(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!target.isConnected) return;
      status.textContent = '';
      const own = !publicView && GP.state.account?.username.toLowerCase() === profile.username.toLowerCase();
      const info = node('div', '', 'profile-info');
      if (profile.has_avatar) {
        const image = node('img', '', 'profile-avatar'); image.src = avatarUrl(profile);
        image.alt = `${profile.display_name}'s avatar`; info.append(image);
      }
      const details = node('div');
      details.append(node('h3', profile.display_name), node('div', `@${profile.username}`, 'hint'));
      for (const [key, label] of [['bio','About'],['location','Location'],['interests','Interests']]) {
        if (profile[key]) details.append(node('p', `${label}: ${profile[key]}`));
      }
      info.append(details); target.append(info);
      if (own) {
        const header = target.querySelector('.profile-header');
        header.insertBefore(button('edit profile', () => GP.editProfile()), header.lastElementChild);
      }
      target.append(connectionsSection(profile, false, publicView));
      target.append(node('h3', 'Personal board'));
      if (own) {
        const form = node('form', '', 'profile-form');
        const input = node('textarea'); input.maxLength = 2000; input.rows = 3;
        input.placeholder = 'Write a public post'; input.setAttribute('aria-label','Public board post');
        let attachmentId = '', uploading = false;
        const attachmentStatus = node('div', '', 'hint');
        attachmentStatus.setAttribute('role', 'status');
        const picker = node('input'); picker.type = 'file'; picker.hidden = true;
        const cameraPicker = node('input'); cameraPicker.type = 'file'; cameraPicker.hidden = true;
        cameraPicker.accept = 'image/*'; cameraPicker.setAttribute('capture', 'environment');
        const upload = button('upload', () => { picker.value = ''; picker.click(); });
        const camera = button('camera', () => { cameraPicker.value = ''; cameraPicker.click(); });
        const select = node('select'); select.hidden = true;
        select.setAttribute('aria-label', 'Personal board attachment from MyDatabase');
        const database = button('MyDatabase', async () => {
          if (!select.hidden) { select.hidden = true; return; }
          database.disabled = send.disabled = true;
          try {
            const {files = []} = await GP.api('/api/id/files');
            if (!target.isConnected) return;
            select.replaceChildren();
            const empty = node('option', files.length ? 'Choose a file' : 'No files available'); empty.value = ''; select.append(empty);
            for (const file of files) {
              const option = node('option', GP.fileName(file)); option.value = file.file_id; select.append(option);
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
        const remove = button('remove attachment', () => { attachmentId = ''; attachmentStatus.textContent = ''; remove.hidden = true; });
        remove.hidden = true;
        const send = node('button','publish'); send.type = 'submit';
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
        const actions = node('div', '', 'profile-actions personal-board-actions');
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
      const boardPosts = node('div', '', own ? 'personal-board-posts' : 'personal-board-posts public-board-scroll');
      if (!own) { boardPosts.tabIndex=0; boardPosts.setAttribute('aria-label', 'Personal board posts'); }
      target.append(boardPosts);
      if (!profile.posts.length) boardPosts.append(node('div','No posts yet.','hint'));
      for (const post of profile.posts) {
        const entry = node('article','', 'profile-post');
        entry.append(node('div',new Date(post.created * 1000).toLocaleString(),'hint'), node('p',post.text));
        if (post.attachment) {
          const url = `${GP.API_BASE}/api/profile?username=${encodeURIComponent(profile.username)}&attachment=${encodeURIComponent(post.id)}`;
          if (post.attachment.is_image) {
            const image = node('img', '', 'profile-post-image');
            image.src = `${url}&preview=1`; image.alt = post.attachment.name; image.loading = 'lazy';
            image.addEventListener('error', () => {
              image.replaceWith(node('div', 'Image preview unavailable.', 'hint'));
            }, {once: true});
            entry.append(image);
          }
          const download = node('a', `download ${post.attachment.name}`);
          download.href = url; download.download = post.attachment.name;
          entry.append(download);
        }
        if (own) entry.append(button('delete post', async () => {
          if (!window.confirm('Delete this post?')) return;
          try {
            await GP.api('/api/profile/posts',{method:'POST',body:JSON.stringify({delete_id:post.id})});
            entry.remove();
          } catch(error) {status.textContent=error.message;}
        }));
        if (own) {
          boardPosts.append(entry);
        } else {
          const thread = node('details', '', 'profile-post-thread');
          const summary = node('summary', '', 'profile-post-summary');
          const date = node('time', new Date(post.created * 1000).toLocaleString(), 'hint');
          date.dateTime = new Date(post.created * 1000).toISOString();
          summary.append(date);
          if (post.attachment?.is_image) {
            const thumbnail = node('img', '', 'profile-post-thumb');
            thumbnail.src = `${GP.API_BASE}/api/profile?username=${encodeURIComponent(profile.username)}&attachment=${encodeURIComponent(post.id)}&preview=1`;
            thumbnail.alt = post.attachment.name; thumbnail.loading = 'lazy';
            thumbnail.addEventListener('error', () => thumbnail.replaceWith(node('span', 'Image unavailable', 'hint')), {once:true});
            summary.append(thumbnail);
          } else {
            const words = (post.text || post.attachment?.name || '').trim().split(/\s+/);
            summary.append(node('span', words.slice(0,12).join(' ') + (words.length > 12 ? '...' : '')));
          }
          entry.classList.add('profile-post-expanded');
          entry.tabIndex=0; entry.setAttribute('aria-label','Opened personal board post');
          thread.append(summary, entry); boardPosts.append(thread);
        }
      }
    } catch(error) {status.textContent=error.message;}
  };

  GP.editProfile = async function () {
    if (!GP.requireAccount()) return;
    const username = GP.state.account.username;
    const target = panel('Edit profile');
    const status = node('div','loading...', 'hint'); status.setAttribute('role','status'); target.append(status);
    try {
      const {profile} = await GP.api(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!target.isConnected) return;
      status.textContent = 'These profile details and your avatar will be public.';
      const form = node('form','', 'profile-form');
      const image = node('img','', 'profile-avatar'); image.alt='Avatar'; image.hidden=!profile.has_avatar;
      if (profile.has_avatar) image.src=avatarUrl(profile);
      form.append(image);
      let avatarId, removed=false, uploading=false, previewVersion=0;
      const avatarStatus = node('div','', 'hint');
      const select = node('select'); select.setAttribute('aria-label','Avatar from MyDatabase');
      const initial=node('option','Select from MyDatabase'); initial.value=''; select.append(initial);
      async function populate() {
        const {files=[]} = await GP.api('/api/id/files');
        if (!target.isConnected) return;
        select.replaceChildren(initial);
        files.filter(GP.isImageFile).forEach(file=>{
          const option=node('option', GP.fileName(file)); option.value=file.file_id; select.append(option);
        });
      }
      async function choose(id) {
        const version=++previewVersion;
        avatarId=id; removed=false; avatarStatus.textContent='Avatar selected. Save profile to publish it.';
        image.hidden=true;
        try {
          const response=await fetch(`${GP.API_BASE}/api/id/file/fx?file_id=${encodeURIComponent(id)}`, {
            headers:{'X-ID-Session':GP.token(),'X-Device-ID':GP.deviceId()}
          });
          if(!response.ok) throw new Error('Avatar FX preview is unavailable.');
          const blob=await response.blob();
          if(version!==previewVersion || !target.isConnected || removed) return;
          const url=URL.createObjectURL(blob);
          image.onload=image.onerror=()=>URL.revokeObjectURL(url);
          image.src=url; image.hidden=false;
        } catch(error) {
          if(version===previewVersion && target.isConnected) avatarStatus.textContent=error.message;
        }
      }
      select.addEventListener('change',()=>{if(select.value) choose(select.value);});
      async function upload(file) {
        if (!file || uploading) return;
        if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name)) {
          avatarStatus.textContent='Choose an image.'; return;
        }
        uploading=true; save.disabled=true; avatarStatus.textContent='Uploading avatar...';
        try {
          const result=await GP.uploadFile(file,'profile'); await choose(result.file.file_id);
          await populate(); select.value=result.file.file_id;
        } catch(error) {avatarStatus.textContent=error.message;}
        finally {uploading=false;save.disabled=false;}
      }
      const avatarActions=node('div','', 'profile-actions');
      for(const [label,camera] of [['upload avatar',false],['take picture',true]]) {
        const picker=node('input'); picker.type='file'; picker.accept='image/*'; picker.hidden=true;
        if(camera) picker.setAttribute('capture','user');
        picker.addEventListener('change',()=>void upload(picker.files[0]));
        avatarActions.append(picker,button(label,()=>{picker.value='';picker.click();}));
      }
      avatarActions.append(button('remove avatar',()=>{previewVersion++;avatarId=undefined;removed=true;image.hidden=true;select.value='';avatarStatus.textContent='Avatar will be removed when saved.';}));
      form.append(avatarActions, select, avatarStatus);
      const inputs={};
      for(const [key,label,max] of [['display_name','Display name',80],['bio','About me',1000],['location','Location (optional)',120],['interests','Interests',300]]) {
        const field=node('label',label); const input=node(key==='bio'?'textarea':'input');
        input.value=profile[key]||''; input.maxLength=max; if(key==='bio') input.rows=4;
        field.append(input); form.append(field); inputs[key]=input;
      }
      const save=node('button','save profile'); save.type='submit';
      form.append(save,button('cancel',()=>GP.showProfile(username)));
      form.addEventListener('keydown',event=>event.stopPropagation());
      form.addEventListener('submit',async event=>{
        event.preventDefault();event.stopPropagation();
        if(uploading||save.disabled||!GP.requireAccount())return;
        save.disabled=true;
        const body=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]));
        if(avatarId)body.avatar_file_id=avatarId;
        if(removed)body.remove_avatar=true;
        try {
          const result = await GP.api('/api/profile',{method:'POST',body:JSON.stringify(body)});
          if (GP.state.account?.username === username) {
            GP.state.account.display_name = result.profile.display_name;
            GP.updateSession();
          }
          await GP.showProfile(username);
        } catch(error) {status.textContent=error.message;save.disabled=false;}
      });
      target.append(form);
      target.append(connectionsSection(profile, true));
      target.append(node('h3','Personal board'),button('open personal board',()=>GP.showProfile(username)));
      await populate().catch(error=>{avatarStatus.textContent=`MyDatabase unavailable: ${error.message}`;});
    }catch(error){status.textContent=error.message;}
  };
})(window.GhostProtocol);
