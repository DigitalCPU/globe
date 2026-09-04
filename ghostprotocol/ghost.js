(function () {
  const modules = [
    'modules/core.js',
    'modules/ui.js',
    'modules/control.js',
    'modules/auth.js',
    'modules/files.js',
    'modules/board.js',
    'modules/chat.js',
    'modules/app.js'
  ];

  function loadNext(index) {
    if (index >= modules.length) return;
    const script = document.createElement('script');
    script.src = `${modules[index]}?v=ghost28`;
    script.onload = () => loadNext(index + 1);
    script.onerror = () => console.error(`GhostProtocol module failed: ${modules[index]}`);
    document.body.appendChild(script);
  }

  if (!window.GhostProtocol) loadNext(0);
})();
