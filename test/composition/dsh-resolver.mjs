import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Resolve DSH's own packages from the installed harness. The plugin itself has
 * no runtime dependency on them; only this test composition needs the real
 * services.
 * @returns {string} absolute DSH install root.
 */
export function installRoot() {
  return path.resolve(process.env.DSH_INSTALL_ROOT ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh')
}

const requireFromDsh = createRequire(path.join(installRoot(), 'package.json'))

/**
 * Resolve one DSH package to a module URL.
 * @param {string} specifier - package specifier.
 * @returns {string} file URL.
 */
export function dshModuleUrl(specifier) {
  return pathToFileURL(requireFromDsh.resolve(specifier)).href
}

/**
 * Import one DSH package.
 * @param {string} specifier - package specifier.
 * @returns {Promise<any>} module namespace.
 */
export function loadDsh(specifier) {
  return import(dshModuleUrl(specifier))
}
