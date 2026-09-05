const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadBackgroundHelpers() {
  const backgroundPath = path.resolve(__dirname, '..', 'background.js');
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const start = source.indexOf('const SUPPORTED_ORIGINS = new Set([');
  const end = source.indexOf('async function writeContentToDisk', start);

  assert.notEqual(start, -1, 'SUPPORTED_ORIGINS must exist');
  assert.notEqual(end, -1, 'writeContentToDisk must follow validateRelativePath');

  const context = { URL };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}this.helpers = { validateRelativePath, isSupportedContentScript, enqueueWrite };`, context);
  return context.helpers;
}

test('accepts workspace-relative paths', () => {
  const { validateRelativePath } = loadBackgroundHelpers();

  assert.deepEqual(Array.from(validateRelativePath('src/app.js')), ['src', 'app.js']);
  assert.deepEqual(Array.from(validateRelativePath('nested\\file.txt')), ['nested', 'file.txt']);
  assert.deepEqual(Array.from(validateRelativePath('a-b/c_d.json')), ['a-b', 'c_d.json']);
});

test('rejects paths that can escape the authorized workspace', () => {
  const { validateRelativePath } = loadBackgroundHelpers();
  const invalidPaths = [
    '',
    '/etc/passwd',
    'C:/Windows/system.ini',
    'C:\\Windows\\system.ini',
    '../secret.txt',
    'src/../secret.txt',
    'src//file.js',
    './file.js',
    'src/\u0000file.js',
    'src/\tfile.js'
  ];

  invalidPaths.forEach(filePath => {
    assert.throws(() => validateRelativePath(filePath), { name: 'TypeError', message: 'INVALID_PATH' });
  });
});

test('only accepts write requests from supported AI content-script tabs', () => {
  const { isSupportedContentScript } = loadBackgroundHelpers();

  [
    'https://gemini.google.com/app',
    'https://chatgpt.com/',
    'https://claude.ai/new',
    'https://chat.deepseek.com/',
    'https://kimi.ai/chat/',
    'https://www.kimi.ai/',
    'https://qwen.ai/',
    'https://chat.qwen.ai/',
    'https://doubao.com/',
    'https://www.doubao.com/',
    'https://grok.com/'
  ].forEach(url => assert.equal(isSupportedContentScript({ tab: { url } }), true));

  assert.equal(isSupportedContentScript({ tab: { url: 'https://example.com/' } }), false);
  assert.equal(isSupportedContentScript({}), false);
});

test('serializes concurrent write operations', async () => {
  const { enqueueWrite } = loadBackgroundHelpers();
  const executionOrder = [];

  const first = enqueueWrite(async () => {
    executionOrder.push('first-start');
    await new Promise(resolve => setTimeout(resolve, 10));
    executionOrder.push('first-end');
  });
  const second = enqueueWrite(async () => {
    executionOrder.push('second-start');
    executionOrder.push('second-end');
  });

  await Promise.all([first, second]);
  assert.deepEqual(executionOrder, ['first-start', 'first-end', 'second-start', 'second-end']);
});
