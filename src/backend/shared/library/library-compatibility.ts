/**
 * Whether a library archive can be used by the bundled compiler.
 *
 * A `.stlib` carries C++ built for the calling convention of the compiler
 * that made it. When that convention changes, an archive from an older (or
 * newer) compiler no longer links, so it is refused here, at install and in
 * the installed list, with the compiler's own plain reason, rather than as a
 * C++ error at the next build. An archive with no C++ (symbol entries only)
 * is always usable; strucpp decides that.
 *
 * Pure: no filesystem, safe for the editor's main process and the web backend.
 */

import { loadStrucpp } from './strucpp-runtime'

/** Why the archive cannot be used by this compiler, or null when it can. */
export function libraryCompatibilityError(archive: unknown): string | null {
  if (!archive || typeof archive !== 'object') return null
  let check: ReturnType<typeof loadStrucpp>['libraryAbiErrors']
  try {
    check = loadStrucpp().libraryAbiErrors
  } catch {
    // No compiler to ask (a test without one): the build still checks.
    return null
  }
  // A compiler without the check predates the convention stamp: nothing to compare.
  if (typeof check !== 'function') return null
  const errors = check([archive as Parameters<typeof check>[0][number]])
  return errors.length > 0 ? errors.map((error) => error.message).join('; ') : null
}
