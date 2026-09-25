// GhostProtocol files feature has been split into modules/files/*.js.
// Keep this tiny namespace shim so older references to modules/files.js do not carry feature code.
(function (GP) {
  GP.Files = GP.Files || {};
})(window.GhostProtocol);
