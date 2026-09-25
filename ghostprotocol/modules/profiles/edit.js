(function (GP) {
  const Profiles = GP.Profiles = GP.Profiles || {};
  GP.editProfile = async function () {
    if (!GP.requireAccount()) return;
    const username = GP.state.account.username;
    const target = Profiles.panel('Edit profile');
    const status = Profiles.node('div','loading...', 'hint'); status.setAttribute('role','status'); target.append(status);
    try {
      const {profile} = await GP.api(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!target.isConnected) return;
      status.textContent = 'These profile details and your avatar will be public.';
      const form = Profiles.node('form','', 'profile-form');
      const image = Profiles.node('img','', 'profile-avatar'); image.alt='Avatar'; image.hidden=!profile.has_avatar;
      if (profile.has_avatar) image.src=Profiles.avatarUrl(profile);
      form.append(image);
      let avatarId, removed=false, uploading=false, previewVersion=0;
      const avatarStatus = Profiles.node('div','', 'hint');
      const select = Profiles.node('select'); select.setAttribute('aria-label','Avatar from MyDatabase');
      const initial=Profiles.node('option','Select from MyDatabase'); initial.value=''; select.append(initial);
      async function populate() {
        const {files=[]} = await GP.api('/api/id/files');
        if (!target.isConnected) return;
        select.replaceChildren(initial);
        files.filter(GP.isImageFile).forEach(file=>{
          const option=Profiles.node('option', GP.fileName(file)); option.value=file.file_id; select.append(option);
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
      const avatarActions=Profiles.node('div','', 'profile-actions');
      for(const [label,camera] of [['upload avatar',false],['take picture',true]]) {
        const picker=Profiles.node('input'); picker.type='file'; picker.accept='image/*'; picker.hidden=true;
        if(camera) picker.setAttribute('capture','user');
        picker.addEventListener('change',()=>void upload(picker.files[0]));
        avatarActions.append(picker,Profiles.button(label,()=>{picker.value='';picker.click();}));
      }
      avatarActions.append(Profiles.button('remove avatar',()=>{previewVersion++;avatarId=undefined;removed=true;image.hidden=true;select.value='';avatarStatus.textContent='Avatar will be removed when saved.';}));
      form.append(avatarActions, select, avatarStatus);
      const inputs={};
      for(const [key,label,max] of [['display_name','Display name',80],['bio','About me',1000],['location','Location (optional)',120],['interests','Interests',300]]) {
        const field=Profiles.node('label',label); const input=Profiles.node(key==='bio'?'textarea':'input');
        input.value=profile[key]||''; input.maxLength=max; if(key==='bio') input.rows=4;
        field.append(input); form.append(field); inputs[key]=input;
      }
      const save=Profiles.node('Profiles.button','save profile'); save.type='submit';
      form.append(save,Profiles.button('cancel',()=>GP.showProfile(username)));
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
      target.append(Profiles.connectionsSection(profile, true));
      target.append(Profiles.node('h3','Personal board'),Profiles.button('open personal board',()=>GP.showProfile(username)));
      await populate().catch(error=>{avatarStatus.textContent=`MyDatabase unavailable: ${error.message}`;});
    }catch(error){status.textContent=error.message;}
  };
})(window.GhostProtocol);
