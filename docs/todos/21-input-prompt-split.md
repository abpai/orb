# #21 — Split InputPrompt into focused hooks and controller

**Severity:** Low (structural)
**Status:** Deferred — will keep accumulating one-off input behaviour without this split

## Problem

`src/ui/components/InputPrompt.tsx` owns too many concerns in one component:

- Text-buffer state, cursor refs (lines 77-93)
- Slash command loading (lines 94-112)
- Async `@` file search (lines 135-174)
- Buffer mutation and editor sync (lines 176-190)
- Keyboard action dispatch (lines 237-309)
- File menu state and open/close synchronisation
- Rendering of both input lines and file menu (lines 311-323)

Text editing, slash completion, async file search, menu ownership, paste
handling, and rendering are coupled.  Any new input feature (e.g. a second
mention type, a new keyboard shortcut) must be woven into this single component.

## Evidence

| Lines | Concern |
|-------|---------|
| `src/ui/components/InputPrompt.tsx:77-93` | all state/ref declarations |
| `src/ui/components/InputPrompt.tsx:94-112` | slash command loading |
| `src/ui/components/InputPrompt.tsx:135-174` | async file mention search |
| `src/ui/components/InputPrompt.tsx:176-190` | buffer mutation + editor sync |
| `src/ui/components/InputPrompt.tsx:237-309` | keyboard dispatch |
| `src/ui/components/InputPrompt.tsx:311-323` | render |

## Remediation direction

Extract three focused hooks:

- **`useTextBufferInput`** — owns `TextBuffer`, cursor, paste, basic key
  dispatch.  Returns buffer contents and a key-handler.
- **`useSlashCompletion`** — owns slash command loading and completion state.
  Takes buffer value, returns `{ suggestions, selectedIndex, onSelect }`.
- **`useFileMentionMenu`** — owns async file search, menu-open state, and
  mention insertion.  Takes `@`-trigger detection, returns `{ isOpen, results, insert }`.

`InputPrompt` becomes a thin compositor that wires these hooks together and
renders the result, with no local state beyond what the hooks expose.
