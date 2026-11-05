# Glorious CORE repair

An unofficial, targeted Windows repair for profile persistence and actuation controls in one identified Glorious CORE build. It patches a local copy supplied by you. This repository contains tooling, tests and minimal patch context; it does not distribute CORE, firmware, complete extracted JavaScript, native binaries, profiles or logs.

## Supported source

| Identifier | Required value |
|---|---|
| Observed application version | 2.1.21 |
| Observed build version | 2.1.21.4 |
| Original `app.asar` SHA-256 | `5a3fd42e820bfa5ee3a89d019b714816f970c9e42103a04364804bce96a5d1ea` |

The complete archive hash is the compatibility gate. Another installation reporting the same version can contain different bytes and will be rejected. This is not a claim of compatibility with every 2.1.21 installation or the latest vendor release.

The repair addresses stale profile-cache saves, profile/layer changes during saves, nonexistent numpad keys being encoded as Escape, failed-write reporting, and several actuation/profile UI controls. See [the defects and changes](docs/bugs.md).

## Build and test

Use Windows with **Node.js 22.12.0 or newer** and npm. From this repository:

```powershell
npm ci
npm test
npm run test:vendor -- --source "C:\Program Files (x86)\Glorious CORE\resources\app.asar"
node scripts/repair.mjs --source "C:\Program Files (x86)\Glorious CORE\resources\app.asar" --output "C:\CORE-repair-output"
```

Choose a writable output directory that does **not** already exist. A wrong source hash or existing output is rejected. The command builds a new `app.asar` and `app.asar.unpacked` in that directory. It does not install or launch an application, change the original files, access HID devices, or flash firmware.

`npm test` checks synthetic archives and tooling safety. `test:vendor` uses your matching local archive, extracts the relevant original code into temporary storage, applies the patches, and runs isolated replays. It checks that the original reproduces the targeted failures and the repaired code passes. See [testing and limits](docs/testing.md).

## Use a separate application copy

1. Fully quit CORE, including its tray/background processes. Closing its window with X may only hide it. Back up its datastore while it is closed; the usual location is `%APPDATA%\Glorious Core\datastore`.
2. Copy the **entire existing application folder** to a separate writable folder. Keep the original installation intact.
3. In the copied application's `resources` folder, replace only `app.asar` and `app.asar.unpacked` with the generated output. Retain all other files from the complete application copy.
4. Launch `Glorious Core.exe` from that copied folder. Use only one copy at a time. Confirm the running executable's location before changing settings.

No administrator setup, security-setting changes or firmware flash are part of this procedure. Keep private datastore backups outside this public repository.

The original and copied applications share the datastore. To roll back the application, fully quit the repaired copy and run the original. This does not roll back settings, and the original can reintroduce the profile-save defect. Restore a datastore backup only while both applications are closed.

A vendor update may replace or invalidate the repair. Preserve your backups and recheck compatibility; do not bypass the hash gate for a new build.

## Validation status

Live validation covered one wired GMMK 3 HE 75% ANSI keyboard. Typed actuation saves, profile switching and application restart preserved the expected saved configuration. The saved profile data remained unchanged after a USB reconnect. Layout tests cover 65%, 75% and 100% fixtures offline.

This does not establish independent firmware readback, physical threshold calibration, measured latency, or every keyboard feature. A recurrent dark/typing-freeze symptom predated the repair and remains unexplained. USB reconnection occurred during the investigation, and the user later reported the app working; **this is not a verified freeze fix**.

Project-authored tooling and test harnesses are MIT-licensed. Vendor patch context is not relicensed; see [NOTICE](NOTICE).
