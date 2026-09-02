# GhostProtocol Modules

GhostProtocol is loaded directly by `ghostprotocol/index.html`; there is no build step.

- `core.js` holds shared DOM references, state, storage keys, API calls, terminal output helpers, and small utilities.
- `ui.js` holds the visible help/menu text and terminal command buttons.
- `control.js` holds owner/control-panel command access.
- `auth.js` holds sign-up, sign-in, sign-out, and session refresh.
- `files.js` holds uploads, camera upload, MyDatabase, categorized file sections, image gallery previews, text document reading, rename, download, and send-to-board actions.
- `board.js` holds the message board, thread view, replies, and owner delete controls.
- `app.js` wires commands, form submission, window controls, fullscreen behavior, and startup.

Keep backend-only logic in the local Python project. Public browser code should call backend API endpoints rather than storing private data here.
