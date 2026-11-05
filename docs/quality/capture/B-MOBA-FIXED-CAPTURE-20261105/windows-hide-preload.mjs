/**
 * B-MOBA-FIXED-CAPTURE-20261105 one-run Windows console-hiding wrapper.
 *
 * The repository's fixed `vite.capture.config.ts` and `vite.config.ts` call
 * `execFileSync('git', ...)` without `windowsHide`. That option is applied in
 * the parent process for the child it spawns, so hiding only the outer Node
 * process is not enough. This preload forces `windowsHide: true` on every
 * public `node:child_process` entry point and on the internal
 * `ChildProcess.prototype.spawn` path used by core helpers, then refreshes the
 * ESM named exports of `node:child_process` with `syncBuiltinESMExports()`.
 *
 * It is injected only into this run's build and capture processes with
 * `node --import`; it does not modify repository source, global NODE_OPTIONS,
 * or any other process on the machine.
 */
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

const APPLIED = Symbol.for('moba.fixed-capture.windowsHidePreload');
const isOptions = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hidden = options => ({...(isOptions(options) ? options : {}), windowsHide: true});

function wrapSpawn(fn) {
  return function spawnWithHiddenWindow(command, args, options) {
    if (Array.isArray(args)) return fn.call(this, command, args, hidden(options));
    if (args === undefined) return fn.call(this, command, [], hidden(undefined));
    return fn.call(this, command, [], hidden(args));
  };
}

function wrapExec(fn) {
  return function execWithHiddenWindow(command, options, callback) {
    if (typeof options === 'function') return fn.call(this, command, hidden(undefined), options);
    if (options === undefined && callback === undefined) return fn.call(this, command, hidden(undefined));
    if (callback === undefined) return fn.call(this, command, hidden(options));
    return fn.call(this, command, hidden(options), callback);
  };
}

function wrapExecFile(fn) {
  return function execFileWithHiddenWindow(file, args, options, callback) {
    let positional = [];
    let optionsValue = {};
    let done = callback;
    if (typeof args === 'function') {
      done = args;
    } else if (Array.isArray(args)) {
      positional = args;
      if (typeof options === 'function') done = options;
      else optionsValue = options;
    } else if (isOptions(args)) {
      optionsValue = args;
      if (typeof options === 'function') done = options;
    } else if (typeof options === 'function') {
      done = options;
    }
    const finalOptions = hidden(optionsValue);
    if (done === undefined) return fn.call(this, file, positional, finalOptions);
    return fn.call(this, file, positional, finalOptions, done);
  };
}

function wrapExecFileSync(fn) {
  return function execFileSyncWithHiddenWindow(file, args, options) {
    if (Array.isArray(args)) return fn.call(this, file, args, hidden(options));
    if (isOptions(args)) return fn.call(this, file, [], hidden(args));
    return fn.call(this, file, [], hidden(undefined));
  };
}

function wrapExecSync(fn) {
  return function execSyncWithHiddenWindow(command, options) {
    return fn.call(this, command, hidden(options));
  };
}

/**
 * Apply the wrapper to a child_process-shaped object. `target` may be a stub in
 * the offline test; the real preload passes the built-in module and the
 * ESM-export synchronizer. Returns false when already applied.
 */
export function applyWindowsHide(target, synchronize = () => {}) {
  if (!target || target[APPLIED]) return false;
  Object.defineProperty(target, APPLIED, {value: true, enumerable: false});

  const originals = {};
  for (const [name, wrap] of [
    ['spawn', wrapSpawn],
    ['spawnSync', wrapSpawn],
    ['exec', wrapExec],
    ['execSync', wrapExecSync],
    ['execFile', wrapExecFile],
    ['execFileSync', wrapExecFileSync],
    ['fork', wrapSpawn],
  ]) {
    if (typeof target[name] !== 'function') throw new Error(`node:child_process has no ${name}()`);
    originals[name] = target[name];
    target[name] = wrap(target[name]);
  }

  // Core helpers construct a ChildProcess and call its prototype spawn method,
  // so wrapping this method also covers nested calls that never re-enter the
  // public module functions. The outer wrappers remain the tested contract.
  const ChildProcess = target.ChildProcess;
  if (ChildProcess && typeof ChildProcess.prototype?.spawn === 'function') {
    const originalProtoSpawn = ChildProcess.prototype.spawn;
    ChildProcess.prototype.spawn = function spawnWithHiddenWindow(options) {
      return originalProtoSpawn.call(this, hidden(options));
    };
  }

  synchronize();
  return {applied: true, originals, prototypeSpawnWrapped: !!(ChildProcess && ChildProcess.prototype)};
}

if (!childProcess[APPLIED]) {
  applyWindowsHide(childProcess, syncBuiltinESMExports);
}
