#!/usr/bin/env node
/**
 * Offline contract test for windows-hide-preload.mjs.
 *
 * Every invocation below targets a stub object; this file must never spawn a
 * process, start a browser, or touch the network. It is run once before the
 * fixed capture build, and the build is blocked if it fails.
 */
import assert from 'node:assert/strict';
import childProcess, {spawn, execFileSync} from 'node:child_process';

// Read the named exports before importing the preload, then confirm the live
// ESM bindings update when the preload calls syncBuiltinESMExports().
const esmSpawnBefore = spawn;
const esmExecFileSyncBefore = execFileSync;
const {applyWindowsHide} = await import('./windows-hide-preload.mjs');

const results = [];
const check = (name, fn) => {
  fn();
  results.push({name, ok: true});
};

function makeStub() {
  const calls = [];
  const record = name => (...args) => {
    calls.push({name, args});
    return {name, args};
  };
  const target = {};
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    target[name] = record(name);
  }
  target.ChildProcess = class StubChildProcess {
    spawn(options) {
      calls.push({name: 'prototype.spawn', args: [options]});
      return true;
    }
  };
  return {target, calls};
}

const {target: stub, calls} = makeStub();
const originalNames = Object.fromEntries(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map(name => [name, stub[name]]));
const originalProto = stub.ChildProcess.prototype.spawn;
let synchronizations = 0;
const applied = applyWindowsHide(stub, () => { synchronizations++; });

check('apply reports wrappers and prototype patch', () => {
  assert.equal(applied.applied, true);
  assert.equal(applied.prototypeSpawnWrapped, true);
  assert.equal(synchronizations, 1);
});

check('fixed Vite config shape execFileSync(git,args,{cwd,encoding}) forces windowsHide', () => {
  calls.length = 0;
  stub.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: 'repo', encoding: 'utf8'});
  const [{args}] = calls;
  assert.equal(args[0], 'git');
  assert.deepEqual(args[1], ['rev-parse', 'HEAD']);
  assert.deepEqual(args[2], {cwd: 'repo', encoding: 'utf8', windowsHide: true});
});

check('spawn overloads keep command, args, options and add windowsHide', () => {
  calls.length = 0;
  stub.spawn('cmd');
  stub.spawn('cmd', ['a']);
  stub.spawn('cmd', ['a'], {env: {X: '1'}});
  stub.spawn('cmd', {env: {X: '2'}});
  assert.deepEqual(calls.map(call => call.args), [
    ['cmd', [], {windowsHide: true}],
    ['cmd', ['a'], {windowsHide: true}],
    ['cmd', ['a'], {env: {X: '1'}, windowsHide: true}],
    ['cmd', [], {env: {X: '2'}, windowsHide: true}],
  ]);
});

check('spawnSync overloads force windowsHide', () => {
  calls.length = 0;
  stub.spawnSync('git', ['status'], {encoding: 'utf8'});
  assert.deepEqual(calls[0].args, ['git', ['status'], {encoding: 'utf8', windowsHide: true}]);
});

check('exec overloads handle options and callback forms', () => {
  calls.length = 0;
  const callback = () => {};
  stub.exec('cmd');
  stub.exec('cmd', {timeout: 1});
  stub.exec('cmd', callback);
  stub.exec('cmd', {timeout: 2}, callback);
  assert.deepEqual(calls[0].args, ['cmd', {windowsHide: true}]);
  assert.deepEqual(calls[1].args, ['cmd', {timeout: 1, windowsHide: true}]);
  assert.deepEqual(calls[2].args, ['cmd', {windowsHide: true}, callback]);
  assert.deepEqual(calls[3].args, ['cmd', {timeout: 2, windowsHide: true}, callback]);
});

check('execSync preserves stdio and forces windowsHide', () => {
  calls.length = 0;
  stub.execSync('cmd', {stdio: 'pipe'});
  assert.deepEqual(calls[0].args, ['cmd', {stdio: 'pipe', windowsHide: true}]);
});

check('execFile overloads preserve callback positions', () => {
  calls.length = 0;
  const callback = () => {};
  stub.execFile('file', callback);
  stub.execFile('file', ['a'], callback);
  stub.execFile('file', ['a'], {cwd: 'x'}, callback);
  stub.execFile('file', {cwd: 'y'}, callback);
  assert.deepEqual(calls[0].args, ['file', [], {windowsHide: true}, callback]);
  assert.deepEqual(calls[1].args, ['file', ['a'], {windowsHide: true}, callback]);
  assert.deepEqual(calls[2].args, ['file', ['a'], {cwd: 'x', windowsHide: true}, callback]);
  assert.deepEqual(calls[3].args, ['file', [], {cwd: 'y', windowsHide: true}, callback]);
});

check('execFileSync overloads force windowsHide', () => {
  calls.length = 0;
  stub.execFileSync('file');
  stub.execFileSync('file', ['a'], {cwd: 'x'});
  stub.execFileSync('file', {cwd: 'y'});
  assert.deepEqual(calls[0].args, ['file', [], {windowsHide: true}]);
  assert.deepEqual(calls[1].args, ['file', ['a'], {cwd: 'x', windowsHide: true}]);
  assert.deepEqual(calls[2].args, ['file', [], {cwd: 'y', windowsHide: true}]);
});

check('fork overloads force windowsHide', () => {
  calls.length = 0;
  stub.fork('module');
  stub.fork('module', ['a'], {env: {X: '1'}});
  assert.deepEqual(calls[0].args, ['module', [], {windowsHide: true}]);
  assert.deepEqual(calls[1].args, ['module', ['a'], {env: {X: '1'}, windowsHide: true}]);
});

check('internal ChildProcess.prototype.spawn path is covered', () => {
  calls.length = 0;
  assert.equal(new stub.ChildProcess().spawn({args: ['a']}), true);
  assert.deepEqual(calls[0].args, [{args: ['a'], windowsHide: true}]);
});

check('application is idempotent', () => {
  const second = applyWindowsHide(stub);
  assert.equal(second, false);
  for (const name of Object.keys(originalNames)) assert.notEqual(stub[name], originalNames[name], `${name} was not wrapped`);
  assert.notEqual(stub.ChildProcess.prototype.spawn, originalProto);
});

check('ESM named exports were synchronized with syncBuiltinESMExports', () => {
  assert.notEqual(spawn, esmSpawnBefore, 'named spawn export did not update');
  assert.notEqual(execFileSync, esmExecFileSyncBefore, 'named execFileSync export did not update');
  assert.equal(typeof childProcess[Symbol.for('moba.fixed-capture.windowsHidePreload')], 'boolean');
});

process.stdout.write(JSON.stringify({applied: applied.applied, checks: results, processesStarted: 0}, null, 2) + '\n');
