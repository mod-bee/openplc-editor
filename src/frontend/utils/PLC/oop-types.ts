import type { SystemLibrary } from '../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../middleware/shared/ports/types'

/**
 * The object-oriented relations between the types a project can name (IEC
 * 61131-3 Ed.3 6.6.5, 6.6.6): which function block EXTENDS which, which
 * interfaces a block IMPLEMENTS, which interface EXTENDS which, and which
 * blocks are ABSTRACT — from the project's own POUs and the installed
 * libraries alike.
 *
 * Pure: built from the data it is given, so the graphical editors, the type
 * checks and the CLI all answer the same question the same way.
 */
export interface OopTypeIndex {
  /** Upper-case block name → its base and the interfaces it names. */
  blocks: Map<string, { extends?: string; implements: string[]; isAbstract: boolean }>
  /** Upper-case interface name → the interfaces it EXTENDS. */
  interfaces: Map<string, { extends: string[] }>
}

const splitNames = (list: string | undefined): string[] =>
  (list ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')

export function buildOopTypeIndex(
  pous: readonly PLCPou[],
  systemLibraries: readonly SystemLibrary[] = [],
): OopTypeIndex {
  const index: OopTypeIndex = { blocks: new Map(), interfaces: new Map() }
  // Libraries first, so a project's own POU of the same name wins, as it does
  // everywhere else.
  for (const library of systemLibraries) {
    for (const iface of library.interfaces ?? []) {
      index.interfaces.set(iface.name.toUpperCase(), { extends: iface.extends ?? [] })
    }
    for (const pou of library.pous) {
      if (pou.type !== 'function-block') continue
      index.blocks.set(pou.name.toUpperCase(), {
        ...(pou.extends !== undefined ? { extends: pou.extends } : {}),
        implements: pou.implements ?? [],
        isAbstract: pou.isAbstract === true,
      })
    }
  }
  for (const pou of pous) {
    if (pou.pouType === 'interface') {
      index.interfaces.set(pou.name.toUpperCase(), { extends: splitNames(pou.interface?.extends) })
    } else if (pou.pouType === 'function-block') {
      index.blocks.set(pou.name.toUpperCase(), {
        ...(pou.interface?.extends ? { extends: pou.interface.extends } : {}),
        implements: pou.interface?.implements ?? [],
        isAbstract: pou.interface?.isAbstract === true,
      })
    }
  }
  return index
}

/** The interfaces named and every one they EXTEND (6.6.6.6.1), upper case. */
function interfaceClosure(index: OopTypeIndex, names: readonly string[]): Set<string> {
  const out = new Set<string>()
  const visit = (name: string): void => {
    const upper = name.toUpperCase()
    if (out.has(upper)) return
    out.add(upper)
    for (const base of index.interfaces.get(upper)?.extends ?? []) visit(base)
  }
  names.forEach(visit)
  return out
}

/** A block and the blocks it EXTENDS, nearest first, upper case. */
function blockLineage(index: OopTypeIndex, name: string): string[] {
  const lineage: string[] = []
  let current: string | undefined = name.toUpperCase()
  while (current !== undefined && !lineage.includes(current)) {
    const block = index.blocks.get(current)
    if (!block) break
    lineage.push(current)
    current = block.extends?.toUpperCase()
  }
  return lineage
}

/** Whether `name` is an interface the index knows. */
export function isInterfaceType(index: OopTypeIndex, name: string): boolean {
  return index.interfaces.has(name.toUpperCase())
}

/** Whether `name` is an ABSTRACT function block (6.6.5.8.2): never instantiated. */
export function isAbstractBlock(index: OopTypeIndex, name: string): boolean {
  return index.blocks.get(name.toUpperCase())?.isAbstract === true
}

/**
 * Whether a value of type `source` may be given where `target` is expected,
 * beyond the two being the same type:
 *
 * - `target` an interface (6.6.6.5.1): an instance of a block implementing it
 *   — directly, through a base it EXTENDS, or through an interface EXTENDING
 *   it — or a variable of the same or a derived interface;
 * - `target` a function block (6.6.5.5.2, 6.6.7.2.8): an instance of a block
 *   that EXTENDS it, directly or not.
 */
export function isOopAssignable(index: OopTypeIndex, source: string, target: string): boolean {
  const wanted = target.toUpperCase()
  const given = source.toUpperCase()
  if (given === wanted) return true
  if (index.interfaces.has(wanted)) {
    if (index.interfaces.has(given)) return interfaceClosure(index, [given]).has(wanted)
    const lineage = blockLineage(index, given)
    if (lineage.length === 0) return false
    const named = lineage.flatMap((block) => index.blocks.get(block)?.implements ?? [])
    return interfaceClosure(index, named).has(wanted)
  }
  if (index.blocks.has(wanted)) return blockLineage(index, given).includes(wanted)
  return false
}
