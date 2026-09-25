# GhostProtocol frontend modules

GhostProtocol is loaded directly by `ghostprotocol/index.html`; there is no build step. Keep script order explicit because modules attach functions to the shared `window.GhostProtocol` namespace.

## Core boot modules

- `core.js` holds shared DOM references, app state, storage keys, API calls, terminal output helpers, command normalization, and small utilities.
- `ui.js` holds visible help/menu text and terminal shortcut buttons.
- `control.js` holds owner/control-panel command access.
- `auth.js` holds sign-up, sign-in, sign-out, and session refresh.
- `app.js` wires command routing, form submission, window controls, fullscreen behavior, and startup.

## Feature modules

- `files.js` is now a tiny compatibility shim for the `GP.Files` namespace.
- `files/core.js` holds upload, camera upload, file typing, metadata, download, and shared file action helpers.
- `files/preview.js` holds file previews, FX image loading, board image previews, image/document chat panels, file rename/delete, and send-to-board.
- `files/analysis.js` holds DB3 inspection, local AI file questions, and saved image analysis display.
- `files/database.js` holds MyDatabase rendering, file rows, image list/gallery/scroll modes, and categorized file sections.
- `board.js` holds the public message board, thread view, replies, and owner delete controls.
- `chat/options.js` holds voice/AI option displays and voice preset assignment.
- `chat/voice-playback.js` holds TTS audio fetch, playback, stop, and reply voice toggling.
- `chat.js` holds GhostProtocol terminal AiTool flow and file attachment commands.
- `lobby.js` holds the public lobby.
- `profiles.js` is now a tiny compatibility shim for the `GP.Profiles` namespace.
- `profiles/core.js` holds profile DOM helpers, avatar URL helpers, and shared profile panel creation.
- `profiles/connections.js` holds connection add/remove commands and connection list rendering.
- `profiles/view.js` holds public profile display and personal board rendering.
- `profiles/edit.js` holds profile editing, avatar upload/selection, and public profile save actions.
- `mail.js` holds inbox, private message compose, polling, and message deletion.
- `eva.js` holds Agent EVA-0 panel commands and session header integration.

Backend-only logic remains in Python. Keep secrets, relay config, local storage, and admin-only operations out of this frontend folder unless they are deliberately exposed by a backend route.



