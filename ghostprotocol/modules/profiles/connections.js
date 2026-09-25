(function (GP) {
  const Profiles = GP.Profiles = GP.Profiles || {};
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
  Profiles.connectionsSection = function connectionsSection(profile, editable=false, publicView=false) {
    const own=!publicView && GP.state.account?.username.toLowerCase()===profile.username.toLowerCase();
    const section=Profiles.node(own ? 'section' : 'details','', 'profile-connections');
    const heading=Profiles.node(own ? 'h3' : 'summary','Connections');
    const list=Profiles.node('div','', 'connection-list');
    if (!own) { list.classList.add('connection-strip'); list.tabIndex=0; list.setAttribute('aria-label','Connections'); }
    const status=Profiles.node('div','', 'hint'); status.setAttribute('role','status');
    function render(next) {
      profile=next; list.replaceChildren();
      const entries=profile.connections || [];
      if (profile.connections_visible === false && !own) { section.hidden=true; return; }
      section.hidden=false;
      if (!entries.length) list.append(Profiles.node('span','No connections yet.','hint'));
      for (const user of entries) {
        const link=Profiles.button('',()=>GP.showProfile(user.username)); link.className='connection-link';
        const square=Profiles.node('span','', 'connection-avatar');
        if(user.has_avatar) {
          const image=Profiles.node('img'); image.src=Profiles.avatarUrl(user); image.alt=''; image.loading='lazy';
          image.addEventListener('error',()=>image.remove(),{once:true}); square.append(image);
        }
        link.append(square,Profiles.node('span',user.username)); list.append(link);
      }
    }
    section.append(heading);
    if(editable) {
      const label=Profiles.node('label','', 'connections-visibility');
      const toggle=Profiles.node('input'); toggle.type='checkbox'; toggle.checked=profile.connections_visible !== false;
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
      const form=Profiles.node('form','', 'connection-command');
      const input=Profiles.node('input'); input.setAttribute('aria-label','Connection command'); input.placeholder='username add / username remove'; input.maxLength=270;
      const submit=Profiles.node('Profiles.button','submit'); submit.type='submit'; form.append(input,submit);
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
})(window.GhostProtocol);
