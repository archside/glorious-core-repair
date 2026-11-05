# Defects and repair scope

These findings apply to the exact archive fingerprint in the [README](../README.md). They come from focused inspection, isolated replay, and the limited live checks described in [testing](testing.md).

## Profile saves could be overwritten later

CORE held both an active renderer profile and a separate cached profile array. Actuation Save replaced the renderer state and persisted its profile without updating the cache. A later disconnect or connection refresh saved the older cached array over the newer settings.

The repair keeps profile activation and the cache aligned by profile ID. After successful actuation writes, it commits the requested layer's HE properties into the latest corresponding profile and persists that profile. This also preserves the object identity used by subsequent cache-based saves.

Committing an entire captured renderer state after awaited writes would introduce another problem: a profile or layer selection received during the save could be undone. The repair merges only the target layer's HE properties, preserving the latest active selection and unrelated settings. Actuation reports already encode their target profile/layer; a selection change does not require retargeting those reports.

## Nonexistent numpad keys could target Escape

Numbers Quick Select could include numpad identifiers on a keyboard without those physical keys. Their missing physical mapping became zero during packet encoding, and physical key zero is Escape.

The UI now filters quick selections against the physical layout. The backend skips a missing mapping before encoding. Its null check deliberately preserves a valid mapping of zero, so an explicit Escape override still works. The 100% layout retains its actual numpad keys.

## Failed writes could appear successful

The HE transport path previously logged a negative native write result and continued. An absent write handle could also return without surfacing a failure. The repair rejects those cases so the existing IPC error path reports failure and the actuation save does not commit the new local state.

This is transport-error handling, not firmware acknowledgement. The native API's zero-return contract is not established, so zero handling is unchanged. A failure partway through several commands can leave partial hardware state; the repair does not attempt an unverified hardware rollback.

## UI controls did not consistently apply their intended action

| Control | Change |
|---|---|
| Nested tab labels | Resolve the labeled ancestor when a click lands on a child element. Keep the tab callback dependency aligned with its handler. |
| Actuation text field | Maintain an editable draft, validate and normalize it on blur, and update selected keys through the existing preview handler. Invalid input or no selection does not change the preview. |
| Quick Select / All | Include only physical, selectable keys for the displayed layout. |
| Profile card | Allow the card body and Enter/Space to use the existing activation callback. Nested actions retain their own behavior without duplicate activation. |

The repair retains CORE's existing Save and activation flows. It does not introduce an alternative firmware protocol, automatic profile presets, or new keyboard features.

## Outside the repair's scope

The recurrent dark/typing-freeze symptom is unresolved. A similar symptom was reported before the repair; that history does not establish its cause or rule out a contribution from application/configuration writes. Configuration persistence after reconnection is not evidence that freezing has been fixed.

There is no independent actuation, polling or debounce settings readback in the inspected handler. UI values and saved files therefore cannot establish physical thresholds or timing. In this build, CORE's 0 ms and 2 ms latency choices encode the same debounce byte.
