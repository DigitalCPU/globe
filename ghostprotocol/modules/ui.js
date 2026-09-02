(function (GP) {
  function help() {
    GP.write('help');
    GP.write('Terminal portal commands:');
    GP.write('  help');
    GP.write('  sign-up        create a terminal profile with name, email, and password');
    GP.write('  sign-in        access an existing terminal profile');
    GP.write('  sign-out       close the active terminal profile');
    if (GP.state.account) {
      GP.write('  menu           show terminal features');
      GP.write('  upload         upload files to your local profile folder');
      GP.write('  mydatabase     open files stored in your local profile folder');
      GP.write('  camera         use camera and save to your local profile folder');
      GP.write('  board          open the message board');
      GP.write('  post board     write a new message board post');
      GP.write('  close board    close the message board view');
    } else {
      GP.write('');
      GP.write('Sign in or sign up to access upload, files, camera, and board features.');
    }
    GP.write('');
    GP.commandButton('sign-in', 'sign-in');
    GP.commandButton('sign-up', 'sign-up');
    if (GP.state.account) {
      GP.commandButton('menu', 'menu');
      GP.commandButton('mydatabase', 'mydatabase');
      GP.commandButton('board', 'board');
    }
    GP.write('');
  }

  function menu() {
    if (!GP.state.account) {
      GP.write('Access denied. Use sign-in or sign-up first.', 'error');
      return;
    }
    GP.write(`terminal access granted: ${GP.state.account.display_name || GP.state.account.username}`);
    GP.write('1) upload files');
    GP.write('2) my database');
    GP.write('3) use camera');
    GP.write('4) message board');
    GP.write('5) sign out');
    GP.commandButton('upload', 'upload');
    GP.commandButton('mydatabase', 'mydatabase');
    GP.commandButton('camera', 'camera');
    GP.commandButton('board', 'board');
    GP.commandButton('post board', 'post-board');
    GP.commandButton('sign out', 'sign-out');
    GP.write('');
  }

  GP.help = help;
  GP.menu = menu;
})(window.GhostProtocol);
