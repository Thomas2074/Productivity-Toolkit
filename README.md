# Productivity Toolkit Tampermonkey Script

Productivity Toolkit is a local-first Tampermonkey userscript that adds a small browser productivity suite to normal websites. It keeps settings and user data in Tampermonkey storage and does not require an external server or cloud service.

Current version: `0.2.7`

## Features

- Tucked toolbox-icon side tab that slides out on hover or keyboard focus
- Draggable toolkit panel
- Saved light and dark mode for the toolkit UI
- Text expander for inputs, textareas, and basic contenteditable fields
- Local quick notes with autosave and `.txt` export
- FocusLock site blocking with manual sessions and recurring schedules
- Pomodoro timer with side-tab countdown and completed-session tracking
- Domain-level visible-time tracking with daily and weekly reports
- One-click page highlights for selected text or typed phrases
- Editable keyboard shortcuts
- Per-site toolkit and feature enable/disable rules
- Full JSON backup and restore

## Privacy

The script is designed to be local-first.

- Data is stored with Tampermonkey APIs: `GM_getValue`, `GM_setValue`, and `GM_deleteValue`.
- The script does not intentionally send notes, snippets, reports, settings, or browsing logs to external services.
- Time tracking is stored by domain, not full URL.
- Password fields are skipped by the text expander.
- The project avoids credential storage, password management, and identity autofill.

## Installation

1. Install a userscript manager such as Tampermonkey, Violentmonkey, or a Safari-compatible userscript manager.
2. Open `productivity_toolkit.user.js`.
3. Copy the full script into a new Tampermonkey script.
4. Save it.
5. Visit any normal `http://` or `https://` website and click the tucked toolbox tab on the right edge of the page.

## Default Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+P` | Open or close the toolkit panel |
| `Alt+Shift+N` | Open notes |
| `Alt+Shift+H` | Highlight selected text |
| `Alt+Shift+C` | Clear highlights |
| `Alt+Shift+F` | Start or stop a focus session |

Shortcuts can be changed from the toolkit's Shortcuts tab.

## Project Structure

```text
productivity_toolkit.user.js  Single-file Tampermonkey userscript
README.md                     Project documentation
```

The userscript should remain single-file unless the project direction changes.

## Development Notes

- Keep all core functionality in `productivity_toolkit.user.js`.
- Prefer Tampermonkey storage APIs over browser storage directly.
- Avoid external dependencies unless absolutely necessary.
- Keep UI styles scoped under the toolkit root IDs/classes.
- Be careful with event delegation so checkboxes and form controls keep native behavior.
- Avoid duplicate intervals, duplicate panel instances, and duplicate toast actions.
- Avoid injecting into iframes and cap expensive page scans so the toolkit stays responsive on large pages.
- Bump the userscript `@version` and internal `APP.version` when changing behavior.

## Testing

At minimum, run a syntax check after edits:

```powershell
& 'C:\Users\Thomas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check 'productivity_toolkit.user.js'
```

Recommended manual checks:

- Panel opens, closes, drags, and resets position.
- Tucked toolbox tab is visible, slides out on hover/focus, and opens the panel.
- Light and dark mode toggle correctly and persist after reload.
- Notes autosave and export.
- Snippets add, edit, delete, filter, and enable/disable.
- Text expansion works in text inputs, textareas, and simple contenteditable fields.
- Password and number inputs are not modified by text expansion.
- FocusLock starts, stops, blocks listed domains, and respects schedules.
- Pomodoro starts, pauses, resets, and updates the side-tab countdown.
- Reports render today and current-week data, then export CSV.
- Highlights can be added and cleared.
- Shortcuts can be captured and reset.
- Site rules can disable individual features or the full toolkit, then re-enable it.
- Backup export works, valid backups restore, and invalid backups do not corrupt settings.

## Known Limitations

- Browser autoplay policies may prevent the Pomodoro completion beep.
- Userscripts cannot run on browser-owned pages such as `chrome://`, `edge://`, extension stores, and some built-in PDF/new-tab pages.
- Contenteditable expansion is intentionally conservative and works best in simple editors.
- Highlighting is designed for ordinary article/documentation pages and may avoid or limit very large or complex DOMs.
- FocusLock blocks by domain and subdomain matching, not by full URL path.
