#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const inputFiles = process.argv.slice(2);
if (inputFiles.length !== 2) {
  console.error('Usage: node scripts/replay-renderer.cjs <original-renderer.js> <patched-renderer.js>');
  process.exit(2);
}
const before = fs.readFileSync(inputFiles[0], 'utf8');
const after = fs.readFileSync(inputFiles[1], 'utf8');
const manifestPath = path.resolve(__dirname, '..', 'patches', 'renderer.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
assert.equal(digest(before), manifest.original_sha256);
assert.equal(digest(after), manifest.patched_sha256);
let restored = after;
for (const patch of [...manifest.patches].reverse()) {
  assert.equal(restored.split(patch.after).length - 1, 1);
  restored = restored.replace(patch.after, patch.before);
}
assert.equal(restored, before);

function span(source, start, end) {
  const index = source.indexOf(start);
  assert(index >= 0, start);
  const stop = source.indexOf(end, index + start.length);
  assert(stop > index, end);
  return source.slice(index, stop);
}
function tab(source) {
  const calls = [];
  const context = {
    useTranslate() {}, useParams() {},
    reactExports: {useCallback: callback => callback},
    jsxRuntimeExports: {jsx: (_, props) => props},
    style$k: {'tab-options': 'tabs'}
  };
  const fn = vm.runInNewContext('(' + span(source, 'function DevicePageTabOptions(', '\nfunction DevicePageControls(') + ')', context);
  return {calls, onClick: fn({onChange: (...args) => calls.push(args)}).onClick};
}
function node(dataset, parent = null) {
  return {dataset, parent, classList: {contains: value => value === 'tabs' && parent === null},
    closest() {return this.dataset.key ? this : this.parent?.closest() ?? null;},
    contains(other) {return other === this || !!other.parent && this.contains(other.parent);}};
}
const container = node({});
const option = node({key: 'custom', title: 'Custom'}, container);
const label = node({}, option);
const oldTab = tab(before);
oldTab.onClick({target: label, currentTarget: container});
assert.deepEqual(oldTab.calls, [[undefined, undefined]]);
const newTab = tab(after);
newTab.onClick({target: label, currentTarget: container});
newTab.onClick({target: option, currentTarget: container});
newTab.onClick({target: container, currentTarget: container});
newTab.onClick({target: node({key: 'outside'}), currentTarget: container});
assert.deepEqual(newTab.calls, [['custom', 'Custom'], ['custom', 'Custom']]);

const sliderSource = span(after, '  const actuationSlider_onChange = reactExports.useCallback(', '\n  const actuationInput_onBlur');
const inputSource = span(after, '  const actuationInput_onBlur = reactExports.useCallback(', '\n  const rapidTriggerStates');
function input(selectedKeys) {
  const state = [{keyIdentifier: 'Digit1', actuationPressValue: 2},
    {keyIdentifier: 'Digit2', actuationPressValue: 2}, {keyIdentifier: 'KeyW', actuationPressValue: 1}];
  const drafts = [], updates = [];
  const context = {selectedKeys, previewPerKeyActuationStates: state,
    collectiveActuationInputValue: '2.0 mm', MIN_ACUTATION_DEPTH: 0.1, MAX_ACUTATION_DEPTH: 3.7,
    reactExports: {useCallback: fn => fn}, setActuationInputDraft: value => drafts.push(value),
    setPreviewActuationStates: value => updates.push(value)};
  const commit = vm.runInNewContext(sliderSource + '\n' + inputSource + '\nactuationInput_onBlur;', context);
  return {commit, state, drafts, updates};
}
const edited = input(['Digit1', 'Digit2']);
edited.commit('1.5 mm');
assert.deepEqual(edited.state.map(item => item.actuationPressValue), [1.5, 1.5, 1]);
assert.equal(edited.drafts.at(-1), '1.5 mm');
assert.equal(edited.updates.length, 1);
for (const value of ['', '-', 'garbage', 'NaN', 'Infinity', '0x10', '-1', '0', '0.09', '3.8', '1 mm text']) {
  edited.commit(value);
}
assert.equal(edited.updates.length, 1);
for (const [text, expected] of [['.1', 0.1], ['3.7', 3.7], ['1.54', 1.5], [' 2.0 MM ', 2]]) {
  edited.commit(text);
  assert.equal(edited.state[0].actuationPressValue, expected);
}
const unselected = input([]);
unselected.commit('1.5');
assert.equal(unselected.updates.length, 0);
assert(before.includes('onChange: (value2) => console.log("actuation", value2)'));
assert(after.includes('onChange: setActuationInputDraft,\n                      onBlur: actuationInput_onBlur,'));

const enumValues = new Proxy({}, {get: (_, key) => key});
const wrapped = input(['Digit1', 'Digit2']);
const inputContext = {
  reactExports: {useState: value => [value, () => {}], useRef: () => ({current: null}), useEffect() {}},
  Size: enumValues, ValidateOn: enumValues, TextType$1: enumValues, Color: enumValues,
  styles$y: enumValues, typographyStyles: enumValues, Typography$1() {},
  classNames$1: () => '', calculateValueColor: () => 'text-color',
  jsxRuntimeExports: {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})}
};
const actualInputText = vm.runInNewContext(span(after, 'const InputText = ', '\nconst DEFAULT_PRESET_IDS') + '\nInputText;', inputContext);
const inputTree = actualInputText({value: '2.0 mm', label: '',
  onChange: value => wrapped.drafts.push(value), onBlur: wrapped.commit});
const inputElement = inputTree.props.children.find(child => child?.type === 'input');
inputElement.props.onChange({target: {value: '1.5 mm'}});
assert.equal(wrapped.drafts.at(-1), '1.5 mm');
assert.equal(wrapped.updates.length, 0);
inputElement.props.onBlur({target: {value: '1.5 mm', checkValidity: () => true}});
assert.deepEqual(wrapped.state.map(item => item.actuationPressValue), [1.5, 1.5, 1]);
assert.equal(wrapped.updates.length, 1);
const context = {KeybedComponentIdentifier: enumValues, QuickKeyId: enumValues,
  QuickKeyIdGroupMap: {get() {return [];}},
  KeybedComponentLayoutItem: function(value) {return value;}, style$b: {}};
const objectSource = name => span(before, 'const ' + name + ' = ', '\n};') + '\n};';
const positions = objectSource('HiddenKeys') + '\n' + objectSource('KeyPositions_ANSI');
const declarations = ['GMMK3100KeybedComponentLayout', 'GMMK375ISOKeybedComponentLayout', 'GMMK365KeybedComponentLayout']
  .map(objectSource).join('\n');
const options = span(before, 'const OPTIONS = ', '\nfunction HEKeyQuickSelect(');
const catalog = vm.runInNewContext(declarations + '\n' + positions + '\n' + options + `
({HiddenKeys, KeyPositions_ANSI, OPTIONS,
  GMMK3HE100WiredANSI:{deviceLayout:{components:GMMK3100KeybedComponentLayout}},
  GMMK3HE75WiredANSI:{deviceLayout:{components:GMMK375ISOKeybedComponentLayout}},
  GMMK3HE65WiredANSI:{deviceLayout:{components:GMMK365KeybedComponentLayout}}});`, context);
function select(source, keybedSize) {
  let selected;
  const callback = span(source, 'jsxRuntimeExports.jsx(HEKeyQuickSelect, { selectedKeys, onChange: ', '\n          } }),')
    .split('onChange: ')[1] + '\n          }';
  const fn = vm.runInNewContext('(' + callback + ')', {...catalog, keybedSize,
    selectedKeys: ['KeyW'], deviceSupportData: catalog['GMMK3HE' + keybedSize + 'WiredANSI'],
    setSelectedKeys: value => {selected = Array.from(value);}});
  return {run(key, data) {fn(key, data); return selected;}};
}
const numbers = Array.from(catalog.OPTIONS.get('numbers').keys);
assert.equal(select(before, 75).run('numbers', numbers).filter(key => key.startsWith('Numpad')).length, 10);
for (const size of [65, 75, 100]) {
  const selection = select(after, size);
  const result = selection.run('numbers', numbers);
  assert.equal(result.filter(key => key.startsWith('Digit')).length, 10);
  assert.equal(result.filter(key => key.startsWith('Numpad')).length, size === 100 ? 10 : 0);
  assert(result.includes('KeyW'));
  const all = selection.run('all', []);
  assert(all.every(key => catalog.KeyPositions_ANSI[size].has(key)));
  assert(all.every(key => !catalog.HiddenKeys.All.includes(key)));
  assert.deepEqual(selection.run('clear', []), []);
}
function profileCard(source) {
  const calls = [];
  const context = {useTranslate: () => (_, fallback) => fallback,
    reactExports: {useState: value => [value, () => {}], useMemo: fn => fn(),
      useEffect() {}, useCallback: fn => fn},
    getSupportedDeviceData: () => ({category: 'Keyboard'}),
    DeviceCategory: enumValues, MoreButtonMenuPosition: enumValues,
    IconType$1: enumValues, Color: enumValues, IconSize: enumValues,
    style$1U: enumValues, classNames$1: (...args) => args.filter(Boolean).join(' '),
    jsxRuntimeExports: {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})},
    Icon() {}, MoreButton() {}};
  const fn = vm.runInNewContext(span(source, 'const ProfileTile$1 = ', '\nconst ProfileSelector = ') + '\nProfileTile$1;', context);
  return {calls, node: fn({profile: {id: 'fixture-profile-2', name: 'Profile 2', order: 1},
    device: {productId: 'fixture-keyboard'}, onActivate: profile => calls.push(profile.id)})};
}
assert.equal(profileCard(before).node.props.onClick, undefined);
const card = profileCard(after);
assert.equal(card.node.props.role, 'button');
assert.equal(card.node.props['aria-label'], 'Activate Profile 2');
assert.equal(card.node.props.tabIndex, 0);
card.node.props.onClick({target: {closest: () => null}});
card.node.props.onClick({target: {closest: () => ({className: 'profileStatusIcon'})}});
card.node.props.onClick({target: {closest: () => ({className: 'more-btn-container'})}});
let prevented = 0;
const cardTarget = {};
for (const key of ['Enter', ' ', 'Escape']) {
  card.node.props.onKeyDown({target: cardTarget, currentTarget: cardTarget, key,
    preventDefault() {prevented++;}});
}
card.node.props.onKeyDown({target: {}, currentTarget: cardTarget, key: 'Enter',
  preventDefault() {throw Error('Nested control intercepted');}});
assert.equal(prevented, 2);
assert.deepEqual(card.calls, ['fixture-profile-2', 'fixture-profile-2', 'fixture-profile-2']);
const result = {mode: 'Offline extracted-function replay. No application startup, IPC, HID, or live configuration access.',
  patches: manifest.patches.length,
  checks: ['nested/direct tab clicks and blank/outside clicks', 'typed actuation updates selected keys only',
    'actual shared InputText passes native event.target.value string to repaired blur callback',
    'invalid actuation and no selection leave preview unchanged', 'boundary values and rounding',
    '65/75 Numbers exclude numpad, 100 retains numpad', 'All excludes non-physical keys and Clear empties selection',
    'profile card body/Enter/Space reuse activation, nested actions do not duplicate activation',
    'reverse patches restore original renderer exactly'],
  limits: 'No live renderer, device, save persistence, profile switching, or hardware behavior tested.'};
console.log(JSON.stringify(result, null, 2));
