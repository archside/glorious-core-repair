'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const clone = value => JSON.parse(JSON.stringify(value));
const validKeys = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyV',
];
const overrides = [...validKeys, ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`)]
  .map((keyIdentifier, i) => ({
    keyIdentifier,
    actuationPressValue: i < 4 ? 1 : 1.5,
    rapidTriggerEnabled: false,
    rapidTriggerPressValue: 0.2,
    rapidTriggerReleaseValue: 0.3,
  }));

function makeProfiles() {
  return Array.from({ length: 3 }, (_, order) => ({
    id: `synthetic-profile-${order + 1}`,
    order,
    activeLayerIndex: 0,
    keyboardPerformanceState: { pollingRate: 1000, inputLatency: 16 },
    presetLightingState: {},
    layers: Object.fromEntries(Array.from({ length: 3 }, (_, layer) => [layer, {
      order: layer,
      pollingRate: 1000,
      inputLatency: 16,
      HEProperties: {
        actuationIsGlobal: true,
        actuationVisualisationEnabled: false,
        actuationDeadzoneValue: 3.7,
        globalActuationState: {
          actuationPressValue: 2,
          rapidTriggerEnabled: false,
          rapidTriggerPressValue: 0.2,
          rapidTriggerReleaseValue: 0.3,
        },
        perKeyAcutationStates: [],
        keyBindings_dynamicKeystroke: [],
        keyBindings_modTap: [],
        keyBindings_toggle: [],
      },
    }])),
  }));
}

function extract(source, start, end) {
  const from = source.indexOf(start);
  assert(from >= 0, `Missing source anchor ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `Missing source end ${end}`);
  return source.slice(from, to);
}

function setup(source, { failAt = Infinity, interleave } = {}) {
  const profiles = makeProfiles();
  const disk = new Map(profiles.map(profile => [profile.id, clone(profile)]));
  const sent = [];
  const logged = [];
  const device = {
    deviceProfiles: clone(profiles),
    rendererState: {
      instanceId: 'synthetic-device',
      productId: 'GMMK3HE75WiredANSI',
      currentProfileData: clone(profiles[1]),
    },
    supportedDeviceData: { productId: 'GMMK3HE75WiredANSI' },
    communicationMethod: 'USB',
    communicationIds: { USB: { write: 123 } },
    toRecord() { return {}; },
  };
  const Device = { getGloriousDevice: () => device };
  const DataStorage = {
    saveDeviceInstance() {},
    saveDeviceProfile(profile) { disk.set(profile.id, clone(profile)); },
    findDeviceProfile(id) { return clone(disk.get(id)); },
  };
  let context;
  const write = (_id, _reportId, _length, report) => {
    sent.push(Buffer.from(report));
    if (sent.length === 1 && interleave) interleave({ context, device, disk });
    return sent.length === failAt ? -1 : report.length;
  };
  context = vm.createContext({
    buffer: { Buffer },
    KeyboardDeviceHandler: class {},
    Device,
    DataStorage,
    HID: { setFeatureReport: write, setHIDWrite: write },
    Logger: { logError(message) { logged.push(message); } },
    setTimeout: callback => { callback(); },
    console: { log() {}, debug() {}, warn() {}, error() {} },
    RendererDeviceState: { fromStateProperties: clone },
    IpcResponse: class { success = false; },
    EventManager: { emit() {} },
    AppChannel: { SendToWindow: 'SendToWindow' },
    DeviceChannel: { PropertyUpdate: 'PropertyUpdate' },
  });
  let recovered = 'const REPORT_ID$9 = 0;\n';
  for (const name of [
    'CalculateChecksum', 'ActuationToTravel', 'ActuationToDeadzone',
    'ActuationToRapidTrigger', 'ProfileAndLayerIndexToFWValue',
    'PrepareSetCustomActuationMode', 'PrepareActuationPointAndRapidTriggerMagnetismReport',
    'PrepareSetProfileIndex', 'PrepareBTBuffer', 'KeyNumbers75Percent',
  ]) {
    recovered += extract(source, `const ${name} =`, '\n};') + '\n};\n';
  }
  recovered += 'const PhysicalKeyMapping = () => KeyNumbers75Percent;\n';
  recovered += extract(source,
    'class GMMK3HEDeviceHandler extends KeyboardDeviceHandler {', '\nconst DeviceUpdateId =');
  recovered += '\nglobalThis.Handler = GMMK3HEDeviceHandler;\n';
  recovered += extract(source, '  static saveDeviceToDisk(device) {',
    '\n  static device_onEndpoint2Message')
    .replace('  static saveDeviceToDisk(device) {', 'Device.saveDeviceToDisk = function(device) {') + ';\n';
  recovered += 'class IPCReplay {\n' + extract(source,
    '  static async handlePropertyUpdate(deviceStateData, updateMethod, ...args) {',
    '\n  // static registerLegacyIPCHandlers') + '\n}\nglobalThis.IPCReplay = IPCReplay;';
  vm.runInContext(recovered, context, { timeout: 5000 });
  context.Handler.setPresetLightingEffect = async () => {};
  const update = clone(device.rendererState);
  update.currentProfileData.layers[0].HEProperties.perKeyAcutationStates = clone(overrides);
  return { context, device, disk, sent, logged, update, profiles };
}

const records = profile => profile.layers[0].HEProperties.perKeyAcutationStates;
const perKeyPackets = test => test.sent.filter(packet => packet[1] === 0x1a && packet[6] === 0);
const applyThroughIPC = test => test.context.IPCReplay.handlePropertyUpdate(
  test.device.rendererState,
  test.context.Handler.updateActuation.bind(test.context.Handler), test.update);

async function verify(source) {
  const test = setup(source);
  await test.context.Handler.updateActuation(test.device.rendererState, test.update);
  const profileId = test.profiles[1].id;
  const cacheAfterSave = records(test.device.deviceProfiles[1]).length;
  const packets = perKeyPackets(test);
  test.context.Device.saveDeviceToDisk(test.device);
  const afterBulkSave = records(test.disk.get(profileId)).length;
  await test.context.Handler.setActiveProfile(test.device, test.profiles[0].id);
  await test.context.Handler.setActiveProfile(test.device, profileId);
  const activatedProfileMatchesCache = test.device.rendererState.currentProfileData === test.device.deviceProfiles[1];
  await test.context.Handler.handleDeviceMessage(test.device, Buffer.from([5, 1, 1, 0]), { deviceID: 123 });
  const afterHardwareProfileEvent = records(test.device.rendererState.currentProfileData).length;

  const failure = setup(source, { failAt: 1 });
  const response = await applyThroughIPC(failure);
  const middle = setup(source, { failAt: 6 });
  const midResponse = await applyThroughIPC(middle);
  const missing = setup(source);
  delete missing.device.communicationIds.USB.write;
  const missingResponse = await applyThroughIPC(missing);
  return {
    summary: {
      cacheAfterSave,
      afterBulkSave,
      activatedProfileMatchesCache,
      afterHardwareProfileEvent,
      perKeyPacketCount: packets.length,
      invalidKeysLogged: test.logged.length,
      escapeWrites: packets.filter(packet => packet[7] === 0).length,
      failureSurfaced: response.success === false,
      failureDidNotPersist: records(failure.disk.get(profileId)).length === 0,
      failureDidNotReplaceRenderer: records(failure.device.rendererState.currentProfileData).length === 0,
      missingHandleSurfaced: missingResponse.success === false,
      partialFailureSurfaced: midResponse.success === false,
      partialFailureDidNotPersist: records(middle.disk.get(profileId)).length === 0,
    },
    packets,
  };
}

async function run(original, patched) {
  const baseline = (await verify(original)).summary;
  assert.equal(baseline.cacheAfterSave, 0, 'Baseline cache must reproduce stale profiles');
  assert.equal(baseline.afterBulkSave, 0, 'Baseline bulk-save must reproduce lost settings');
  assert.equal(baseline.escapeWrites, 10, 'Baseline unmapped numpad keys must reproduce Escape writes');
  assert.equal(baseline.failureSurfaced, false, 'Baseline must reproduce swallowed HID failure');
  const repaired = await verify(patched);
  const result = repaired.summary;
  assert.equal(result.cacheAfterSave, 30);
  assert.equal(result.afterBulkSave, 30);
  assert.equal(result.activatedProfileMatchesCache, true);
  assert.equal(result.afterHardwareProfileEvent, 30);
  assert.equal(result.perKeyPacketCount, 20);
  assert.equal(result.invalidKeysLogged, 10);
  assert.equal(result.escapeWrites, 0);
  for (const key of [
    'failureSurfaced', 'failureDidNotPersist', 'failureDidNotReplaceRenderer',
    'missingHandleSurfaced', 'partialFailureSurfaced', 'partialFailureDidNotPersist',
  ]) assert.equal(result[key], true, key);
  const expected = new Map([
    [14, 9], [9, 9], [15, 9], [21, 9],
    [7, 14], [13, 14], [19, 14], [25, 14], [31, 14],
    [37, 14], [43, 14], [49, 14], [55, 14], [61, 14],
    [8, 14], [20, 14], [26, 14], [27, 14], [28, 14], [34, 14],
  ]);
  assert.deepEqual(new Map(repaired.packets.map(packet => [packet[7], packet[5]])), expected);
  assert(repaired.packets.every(packet => packet[2] === 1 && packet[4] === 0));

  const escape = setup(patched);
  records(escape.update.currentProfileData).push({
    keyIdentifier: 'Escape', actuationPressValue: 2, rapidTriggerEnabled: false,
    rapidTriggerPressValue: 0.2, rapidTriggerReleaseValue: 0.3,
  });
  await escape.context.Handler.updateActuation(escape.device.rendererState, escape.update);
  const escapePacket = perKeyPackets(escape).find(packet => packet[7] === 0);
  assert(escapePacket, 'Physical key zero must remain valid for explicit Escape');
  assert.equal(escapePacket[5], 19);
  assert(escape.sent.some(packet => packet[1] === 0x1a && packet[6] === 1 && packet[5] === 19),
    'Global actuation must remain 2 mm');

  const bluetooth = setup(patched, { failAt: 1 });
  bluetooth.device.communicationMethod = 'Bluetooth';
  bluetooth.device.communicationIds.Bluetooth = { write: 123 };
  assert.equal((await applyThroughIPC(bluetooth)).success, false);

  const selection = setup(patched, { interleave: ({ context, device }) => {
    void context.Handler.handleDeviceMessage(device, Buffer.from([5, 1, 0, 0]), { deviceID: 123 });
  } });
  await selection.context.Handler.updateActuation(selection.device.rendererState, selection.update);
  assert.equal(selection.device.rendererState.currentProfileData.id, selection.profiles[0].id);
  assert.equal(records(selection.device.deviceProfiles[1]).length, 30);
  assert.equal(records(selection.disk.get(selection.profiles[1].id)).length, 30);
  assert(selection.sent.filter(packet => packet[1] === 0x1a).every(packet => packet[2] === 1));

  const layer = setup(patched, { interleave: ({ context, device }) => {
    void context.Handler.handleDeviceMessage(device, Buffer.from([5, 1, 1, 1]), { deviceID: 123 });
    device.rendererState.currentProfileData.layers[0].pollingRate = 2000;
  } });
  await layer.context.Handler.updateActuation(layer.device.rendererState, layer.update);
  assert.equal(layer.device.rendererState.currentProfileData.activeLayerIndex, 1);
  assert.equal(layer.device.deviceProfiles[1].activeLayerIndex, 1);
  assert.equal(layer.disk.get(layer.profiles[1].id).activeLayerIndex, 1);
  assert.equal(layer.device.rendererState.currentProfileData.layers[0].pollingRate, 2000);
  assert.equal(records(layer.device.deviceProfiles[1]).length, 30);
  assert.deepEqual(layer.device.deviceProfiles[1].layers[1].HEProperties, layer.profiles[1].layers[1].HEProperties);
  assert(layer.sent.filter(packet => packet[1] === 0x1a).every(packet => packet[2] === 1));
  return {
    status: 'passed',
    scope: 'Extracted vendor functions with synthetic profiles and mocked HID, storage, timers and events.',
    limits: 'No native modules, application startup, device access, hardware persistence or firmware validation.',
    baseline,
    repaired: {
      ...result,
      physicalMappingsAndActuationBytesVerified: true,
      explicitEscapeAtTwoMmSupported: true,
      globalTwoMmPreserved: true,
      bluetoothNegativeWriteSurfaced: true,
      hardwareProfileChangeDuringSavePreserved: true,
      hardwareLayerChangeDuringSavePreserved: true,
      concurrentPerformanceChangePreserved: true,
      inFlightReportsRetainTargetProfileAndLayer: true,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length, 2, 'Usage: node scripts/replay-main.cjs <original-main.js> <patched-main.js>');
  const sources = args.map((file, index) => {
    try { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
    catch { throw new Error(`Unable to read ${index === 0 ? 'original' : 'patched'} source`); }
  });
  console.log(JSON.stringify(await run(...sources), null, 2));
}

main().catch(error => {
  console.log(JSON.stringify({ status: 'failed', error: String(error.message).slice(0, 1000) }, null, 2));
  process.exitCode = 1;
});
