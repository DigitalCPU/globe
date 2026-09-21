(function (GP) {
  let panel=null, unread=0, generation=0, polling=false, session='';
  const sessionKey=()=>GP.state.account ? `${GP.state.account.username}:${GP.token()}` : '';
  const current=key=>key && key===sessionKey();
  function node(tag,text='',className='') {
    const el=document.createElement(tag);el.textContent=text;el.className=className;return el;
  }
  function button(text,action) {
    const el=node('button',text);el.type='button';el.addEventListener('click',action);return el;
  }
  GP.renderMailHint=function () {
    const hint=GP.dom.terminalHint;if(!hint)return;
    hint.querySelector('.mail-alert')?.remove();
    if(!GP.state.chatMode && !GP.renderBoardHeader?.() && !GP.renderSessionLinks?.())hint.textContent=GP.state.headerHint ?? (unread ? '' : "type 'help' to access terminal");
    if(unread && GP.state.account) {
      const alert=button('New Message',()=>void GP.inbox());alert.className='mail-alert';
      alert.setAttribute('aria-label',`New Message (${unread} unread)`);hint.append(alert);
    }
  };
  GP.checkMail=async function () {
    const key=sessionKey(), version=generation;
    if(!key || document.hidden || polling)return;
    polling=true;
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const result=await GP.api('/api/mail?status=1',{signal:controller.signal});
      if(current(key) && version===generation){unread=result.unread;GP.renderMailHint();}
    } catch (_) { /* A temporary outage must not erase known unread state. */ }
    finally{clearTimeout(timeout);if(version===generation)polling=false;}
  };
  GP.mailSessionChanged=function () {
    const key=sessionKey();if(key===session)return;
    session=key;generation++;polling=false;unread=0;panel?.remove();panel=null;
    GP.renderMailHint();void GP.checkMail();
  };
  GP.composeMail=async function (recipient) {
    if(!GP.requireAccount() || GP.state.promptHandler)return;
    const key=sessionKey();
    try {
      if(!recipient)recipient=await GP.promptLine('Mail to username (cancel to stop):');
      if(!current(key) || !recipient.trim() || recipient.trim().toLowerCase()==='cancel')return;
      const text=await GP.promptLine(`Message to ${recipient.trim()} (cancel to stop):`);
      if(!current(key))return;
      if(text.trim().toLowerCase()==='cancel'){GP.write('Message canceled.');return;}
      await GP.api('/api/mail',{method:'POST',body:JSON.stringify({action:'send',recipient:recipient.trim(),text})});
      if(current(key)){GP.write('Message sent.');void GP.checkMail();}
    }catch(error){if(current(key))GP.write(error.message,'error');}
  };
  GP.inbox=async function () {
    if(!GP.requireAccount())return;
    const key=sessionKey();panel?.remove();
    const target=node('section','','mail-panel');panel=target;
    const header=node('div','','profile-header');
    header.append(node('strong','Inbox'),button('new message',()=>void GP.composeMail('')),
      button('refresh',()=>void GP.inbox()),button('close',()=>target.remove()));
    const status=node('div','loading...','hint');status.setAttribute('role','status');
    const list=node('div');const more=button('older messages',()=>void load());more.hidden=true;
    target.append(header,status,list,more);GP.dom.screen.append(target);GP.autoScroll();
    let before=0, loading=false;
    async function load() {
      if(loading)return;loading=true;more.disabled=true;
      try {
        const data=await GP.api(`/api/mail?before=${before}`);
        if(!current(key) || !target.isConnected)return;
        unread=data.unread;GP.renderMailHint();status.textContent=data.messages.length || before ? '' : 'Inbox is empty.';
        for(const message of data.messages) {
          const entry=node('article','','mail-entry');
          const open=button(`${message.read_at ? '' : 'New · '}${message.sender_name} · ${new Date(message.created*1000).toLocaleString()}`,async()=>{
            body.hidden=!body.hidden;open.setAttribute('aria-expanded',String(!body.hidden));
            if(body.hidden || message.read_at || open.disabled)return;
            open.disabled=true;
            try {
              await GP.api('/api/mail',{method:'POST',body:JSON.stringify({action:'read',id:message.id})});
              if(!current(key))return;
              message.read_at=Date.now()/1000;open.textContent=`${message.sender_name} · ${new Date(message.created*1000).toLocaleString()}`;
              await GP.checkMail();
            }catch(error){if(current(key))status.textContent=error.message;}
            finally{open.disabled=false;}
          });
          open.setAttribute('aria-expanded','false');
          const body=node('div');body.hidden=true;
          const remove=button('delete',async()=>{
            if(!window.confirm('Delete this message from your inbox?'))return;
            remove.disabled=true;
            try {
              await GP.api('/api/mail',{method:'POST',body:JSON.stringify({action:'delete',id:message.id})});
              if(current(key)){entry.remove();await GP.checkMail();}
            }catch(error){if(current(key))status.textContent=error.message;remove.disabled=false;}
          });
          body.append(node('p',message.text),button('reply',()=>void GP.composeMail(message.sender_name)),remove);
          entry.append(open,body);list.append(entry);
        }
        before=data.next_before;more.hidden=!before;
      }catch(error){if(current(key) && target.isConnected)status.textContent=error.message;}
      finally{loading=false;more.disabled=false;}
    }
    await load();
  };
  window.setInterval(()=>void GP.checkMail(),15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void GP.checkMail();});
})(window.GhostProtocol);
