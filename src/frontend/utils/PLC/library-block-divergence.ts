/**
 * Does a placed block still match the LIBRARY definition it came from?
 *
 * The graphical editors already ask this of a block backed by a POU in the
 * project, and show an update badge when the answer is no. A block out of an
 * installed library had no such check: the load-time re-stamp reports a pin the
 * library added and deliberately does not apply it — growing a block needs the
 * node's handles rebuilt, which project load will not do — so the console said
 * "1 placed block does not draw it yet" and nothing could act on it.
 *
 * The version is not the question. A library rebuilt in place, which is what
 * developing one looks like, changes the block without changing its version,
 * and the update paths keyed on a version change never fire.
 *
 * Only the pin SET is compared. Everything else the re-stamp handles — a type,
 * a documentation string, `extensible` — it applies on load without needing
 * geometry, so it is already in the block by the time anything is drawn.
 */

import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { SystemLibrary, UserLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCPou } from '@root/middleware/shared/ports/types'

import { resolveMethodBox } from './block-variant'

/** EN/ENO are implicit control pins; a library POU never declares them. */
const IMPLICIT_PINS = new Set(['EN', 'ENO', 'OUT'])

const WIRED_CLASSES = ['input', 'output', 'inOut']

/** Drawn as a pin, and named, so it can be compared at all. */
const isWired = (variable: { name?: string; class?: string }): boolean =>
  WIRED_CLASSES.includes(variable?.class ?? '') && typeof variable?.name === 'string' && variable.name.length > 0

/** Name and side, which is what a redraw depends on. */
const pinKey = (variable: { name: string; class?: string }): string =>
  `${variable.name.toUpperCase()}|${variable.class ?? ''}`

/**
 * The library POU a variant was stamped from, or null when the project owns it.
 *
 * A project POU takes precedence: the project's own interface is the truth for
 * those, and the editors have their own check for them.
 */
export function findLibraryPou(
  variant: Pick<BlockVariant, 'name'>,
  systemLibraries: SystemLibrary[],
  userPouNames: Iterable<string>,
): SystemLibrary['pous'][number] | null {
  // A node can carry a variant with no name -- a block dropped but not yet
  // given one, and whatever a half-written project holds. Nameless is simply
  // not a library block; the comparison this replaced tolerated it by never
  // reaching for the name at all.
  const wanted = upper(variant?.name)
  if (wanted === null) return null

  for (const name of userPouNames) {
    if (upper(name) === wanted) return null
  }

  for (const library of systemLibraries) {
    const match = (library?.pous ?? []).find((pou) => upper(pou?.name) === wanted)
    if (match) return match
  }
  return null
}

/** Upper-cased, or null when there is no name to compare. */
function upper(name: string | undefined | null): string | null {
  return typeof name === 'string' && name.length > 0 ? name.toUpperCase() : null
}

/**
 * True when the placed variant's pins no longer match the library's.
 *
 * Added, removed and side-changed pins all count: each one means the block on
 * the canvas is drawing something other than what the library declares.
 */
export function libraryVariantDiverges(variant: BlockVariant, libraryPou: SystemLibrary['pous'][number]): boolean {
  const wanted = new Set((libraryPou.variables ?? []).filter(isWired).map(pinKey))
  const drawn = new Set(
    (variant.variables ?? []).filter((variable) => isWired(variable) && !IMPLICIT_PINS.has(variable.name)).map(pinKey),
  )

  if (wanted.size !== drawn.size) return true
  for (const pin of wanted) if (!drawn.has(pin)) return true
  return false
}

/**
 * Whether a method box no longer matches its method as declared now: a
 * parameter added, removed or retyped, or the result changed. Also true when
 * the block no longer has the method, so the box shows it needs attention.
 */
export function methodVariantDiverges(
  variant: BlockVariant,
  input: { systemLibraries: readonly SystemLibrary[]; userLibraries: readonly UserLibrary[]; pous: readonly PLCPou[] },
): boolean {
  const now = resolveMethodBox(`${variant.owner ?? ''}.${variant.name}`, { ...input, variables: [] })
  if (now === undefined) return true
  const keys = (variables: readonly { name: string; class?: string; type: { value: string } }[]) =>
    new Set(
      variables
        .filter((variable) => !['EN', 'ENO'].includes(variable.name))
        .map((variable) => `${pinKey(variable)}|${variable.type.value.toUpperCase()}`),
    )
  const wanted = keys(now.variant.variables)
  const drawn = keys(variant.variables ?? [])
  if (wanted.size !== drawn.size) return true
  for (const pin of wanted) if (!drawn.has(pin)) return true
  return false
}
