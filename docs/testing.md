# Testing and evidence limits

## Tooling tests

Use Node.js 22.12.0 or newer. `npm ci` installs the lockfile-pinned dependencies.

```powershell
npm ci
npm test
```

These tests use synthetic archives and fixtures. They exercise archive/tool safety without requiring CORE or contacting a keyboard. Passing them does not establish compatibility with an arbitrary installed application.

The repair command requires the complete original archive fingerprint from the [README](../README.md), refuses an existing output directory, and writes a new output rather than modifying the source. Keep these guarantees when extending the tool; a displayed version number alone is insufficient.

## Replays against your local vendor archive

```powershell
npm run test:vendor -- --source "C:\Program Files (x86)\Glorious CORE\resources\app.asar"
```

This opt-in test requires your own matching archive. Relevant original files are extracted into temporary storage and patched there. Replays isolate the selected handlers and encoders with stubbed HID, storage, timers and events. They do not launch CORE or send hardware commands. Do not commit the temporary extracted code or local application data.

The expected comparisons include:

- Original cache-based saves lose newly saved actuation overrides; repaired saves retain them.
- Profile/layer events during a pending save remain selected, unrelated settings survive, and packets continue addressing the requested target.
- Missing physical mappings are skipped while explicit Escape at physical index zero remains valid.
- Negative writes and absent handles surface as failures. Mid-sequence failure does not commit the new actuation state locally.
- Tab clicks, typed values, quick selection and profile-card activation exercise the repaired handlers, including invalid/no-selection cases and nested actions.
- Offline 65%, 75% and 100% layout fixtures distinguish absent numpad keys from a real numpad.

The original code should fail the intended regression cases and the repaired code should pass. A replay is evidence about those code paths under its test conditions, not complete application or firmware emulation.

## Live checks performed

One wired GMMK 3 HE 75% ANSI keyboard was checked with a separate repaired application copy:

- A typed W threshold was saved at 1.1 mm, then restored and saved at 1.0 mm.
- CORE's latency control was saved at 2 ms and restored to 0 ms; performance saves also sent the configured 1,000 Hz polling value.
- Profile-card activation switched from Profile 1 back to Profile 2. CORE reported Profile 2 active.
- After completed saves, all CORE processes were stopped and the repaired copy relaunched. The profile file was unchanged and the UI reopened with the saved values.
- The final configuration contained 21 physical-key overrides, including explicit Escape at 2.0 mm, with no nonexistent numpad entries. Other profiles and the unused layers matched the original backup.
- Saved settings persisted through a subsequent USB reconnect. The user later reported the app working.

Private logs, profile files and machine-specific evidence are deliberately excluded from this repository. These observations describe one setup, not a device-wide compatibility guarantee.

## What remains unverified

No independent firmware actuation/polling/debounce readback or physical threshold calibration was performed. CORE's saved 0 ms latency setting is not a measured delay; 0 and 2 ms encode identically in this build. Not every feature, device variant, transport, firmware version or update path was tested.

The dark/typing-freeze symptom occurred in the investigation and had also been reported earlier. Its cause remains unresolved. Reconnection and subsequent working configuration do not demonstrate that this repair fixes freezing.

For your own validation, back up settings while CORE is fully closed, use the separate-copy procedure, save a small reversible change, restore it, and check again after fully quitting/relaunching. Treat a dark or nonresponsive keyboard as an unresolved incident; do not infer recovery from an enabled Save button, a successful file write, or Windows USB enumeration alone.
