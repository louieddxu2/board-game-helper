# Workspace focus contract

Workspace loading and dialog focus are separate concerns. A data refresh may update
the directory or table, but it must not replace a focused control merely because
background loading finished.

`WorkspaceModal` receives the current activation from `useWorkspaceInputModality`.
The activation belongs to the click or key event that opens the dialog and expires
at the next task boundary. A dialog opened in a later task has no inferred opener. In particular,
`document.activeElement` is not proof of which control a touch user tapped.

- On open, an editor field with `autoFocus` may take focus. Otherwise keyboard
  activation follows the modal's `initialFocus` choice; pointer activation of a
  button-only dialog focuses its surface without drawing an action outline.
- On close, focus returns to the live opener. When one dialog replaces another,
  the return path follows the earlier dialog's opener if the intermediate action
  has unmounted. A remaining dialog keeps focus inside itself.
- When a keyboard opener has disappeared, focus goes to the named Workspace
  surface. A pointer close with no live opener does not force focus onto another
  control. Never choose an unrelated first button as a fallback.
- A programmatically restored pointer focus has no visible ring until blur or a
  keyboard action. Keyboard focus remains visible.

Before changing this behavior, verify pointer and keyboard opening, backdrop,
close-button and Escape closing, dialog-to-dialog transitions, an opener that
unmounts, navigation during a pending restoration, and a touch tap that leaves
an earlier search field as `document.activeElement`. The unit contracts are in
`src/workspace/workspaceFocus.test.tsx`; the production-build mobile flows are in
`tests/workspace-startup/startup.spec.ts`. Those browser tests run in mobile
Chromium emulation. Check focus appearance and software-keyboard behavior on a
physical iPhone Safari before claiming device-wide coverage.
