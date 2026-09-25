(function () {
  const modules = [
    'modules/core.js',
    'modules/ui.js',
    'modules/control.js',
    'modules/auth.js',
    'modules/files.js',
    'modules/files/core.js',
    'modules/files/preview.js',
    'modules/files/analysis.js',
    'modules/files/database.js',
    'modules/board.js',
    'modules/chat/options.js',
    'modules/chat/voice-playback.js',
    'modules/chat.js',
    'modules/lobby.js',
    'modules/profiles.js',
    'modules/profiles/core.js',
    'modules/profiles/connections.js',
    'modules/profiles/view.js',
    'modules/profiles/edit.js',
    'modules/mail.js',
    'modules/eva.js',
    'modules/app.js'
  ];

  function loadNext(index) {
    if (index >= modules.length) return;
    const script = document.createElement('script');
    script.src = `${modules[index]}?v=structure1`;
    script.onload = () => loadNext(index + 1);
    script.onerror = () => console.error(`GhostProtocol module failed: ${modules[index]}`);
    document.body.appendChild(script);
  }

  if (!window.GhostProtocol) loadNext(0);
})();


