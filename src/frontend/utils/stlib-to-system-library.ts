/**
 * Map a strucpp `.stlib` archive into the editor's `SystemLibrary` shape.
 *
 * `.stlib` archives carry IEC 61131-3 library metadata in a compact,
 * compiler-oriented form (manifest + sources + codegen). The editor's
 * library tree, by contrast, expects each library as a flat list of
 * `SystemLibraryPou` entries with input/output/local variables and a
 * single concrete or generic type per pin. This module is the boundary:
 * it walks one manifest and produces one `SystemLibrary` ready for
 * dispatch into the Zustand library slice.
 *
 * Type encoding:
 *   - Concrete IEC types (`INT`, `BOOL`, `REAL`, …) become
 *     `{ definition: 'base-type', value }`.
 *   - Generic markers (`ANY`, `ANY_NUM`, `ANY_INT`, `ANY_REAL`, `ANY_BIT`,
 *     `ANY_STRING`, `ANY_ELEMENTARY`, `ANY_DATE`, `ANY_CHAR`, `ANY_CHARS`,
 *     `ANY_INTEGRAL`, `ANY_SIGNED`, `ANY_UNSIGNED`, `ANY_MAGNITUDE`)
 *     become `{ definition: 'generic-type', value }`. Tooling unifies
 *     identical generic names across params and the return type at
 *     instantiation — see strucpp's library-manifest docstring.
 *   - Anything else falls through as `'derived-type'`. In practice the
 *     bundled libs only mix concrete + generic, but the fallback keeps
 *     user-installed .stlibs (future library manager) working when they
 *     reference local STRUCT/ENUM names.
 *
 * Function shape:
 *   `.stlib` functions carry `parameters[]` + `returnType`. We synthesize
 *   a synthetic `OUT` output variable from `returnType` so consumers
 *   can render functions like ADD with two input pins and one output
 *   pin without special-casing function vs. function-block. The
 *   `variadic` flag flows through as `extensible: true` for the same
 *   reason — block-rendering code already understands extensible.
 *
 * Function-block shape:
 *   inputs/outputs/inouts arrays in `.stlib` map directly. `inout`
 *   parameters become class `'inOut'` (camel-case the editor uses).
 */

import type { StlibArchiveDTO, StlibMethodDTO } from '../../middleware/shared/ports/library-port'
import type {
  SystemLibrary,
  SystemLibraryInterface,
  SystemLibraryMethod,
  SystemLibraryPou,
  SystemLibraryVariable,
} from '../../middleware/shared/ports/library-types'

const GENERIC_TYPE_NAMES = new Set([
  'ANY',
  'ANY_NUM',
  'ANY_INT',
  'ANY_REAL',
  'ANY_BIT',
  'ANY_STRING',
  'ANY_ELEMENTARY',
  'ANY_DATE',
  'ANY_CHAR',
  'ANY_CHARS',
  'ANY_INTEGRAL',
  'ANY_SIGNED',
  'ANY_UNSIGNED',
  'ANY_MAGNITUDE',
])

const BASE_TYPE_NAMES = new Set([
  'BOOL',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  '__XWORD',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'WSTRING',
])

function typeRef(typeName: string): SystemLibraryVariable['type'] {
  if (GENERIC_TYPE_NAMES.has(typeName)) {
    return { definition: 'generic-type', value: typeName }
  }
  if (BASE_TYPE_NAMES.has(typeName)) {
    return { definition: 'base-type', value: typeName }
  }
  return { definition: 'derived-type', value: typeName }
}

function classFromDirection(d: 'input' | 'output' | 'inout'): SystemLibraryVariable['class'] {
  if (d === 'inout') return 'inOut'
  return d
}

/** A method prototype, its parameters as pins. */
function toMethod(method: StlibMethodDTO): SystemLibraryMethod {
  return {
    name: method.name,
    ...(method.returnType !== undefined ? { returnType: method.returnType } : {}),
    variables: [
      ...method.inputs.map((p) => ({ name: p.name, class: 'input' as const, type: typeRef(p.type) })),
      ...method.outputs.map((p) => ({ name: p.name, class: 'output' as const, type: typeRef(p.type) })),
      ...method.inouts.map((p) => ({ name: p.name, class: 'inOut' as const, type: typeRef(p.type) })),
    ],
  }
}

/**
 * @param options.executionControl - give every block EN / ENO in Ladder and
 *   FBD (`SystemLibraryPou.executionControl`); true for an installed library.
 */
export function stlibToSystemLibrary(
  archive: StlibArchiveDTO,
  options: { executionControl?: boolean } = {},
): SystemLibrary {
  const m = archive.manifest
  const pous: SystemLibraryPou[] = []
  const executionControl = options.executionControl === true ? { executionControl: true as const } : {}

  for (const fn of m.functions) {
    const variables: SystemLibraryVariable[] = [
      ...fn.parameters.map((p) => ({
        name: p.name,
        class: classFromDirection(p.direction),
        type: typeRef(p.type),
      })),
      // Functions return a single value; surface it as a synthetic OUT
      // pin so block-rendering treats functions and FBs uniformly.
      { name: 'OUT', class: 'output' as const, type: typeRef(fn.returnType) },
    ]
    pous.push({
      name: fn.name,
      type: 'function',
      language: 'st',
      variables,
      body: '',
      documentation: fn.documentation ?? '',
      extensible: fn.variadic !== undefined,
      category: fn.category,
      ...executionControl,
    })
  }

  // Native blocks carry their authored file in `archive.sources`, located via
  // the manifest entry's `sourceFile`.
  const sourceByFile = new Map((archive.sources ?? []).map((src) => [src.fileName, src.source]))

  for (const fb of m.functionBlocks) {
    const variables: SystemLibraryVariable[] = [
      ...fb.inputs.map((v) => {
        // An input's declared default (STruC++ writes it into the manifest the
        // way it does for function parameters): the pin may be left unwired.
        const initialValue = (v as { initialValue?: string }).initialValue
        return {
          name: v.name,
          class: 'input' as const,
          type: typeRef(v.type),
          ...(initialValue !== undefined ? { initialValue } : {}),
          // `R_EDGE` / `F_EDGE`: the pin is drawn with the edge marker.
          ...(v.edge !== undefined ? { edge: v.edge } : {}),
        }
      }),
      ...fb.outputs.map((v) => ({
        name: v.name,
        class: 'output' as const,
        type: typeRef(v.type),
      })),
      ...fb.inouts.map((v) => ({
        name: v.name,
        class: 'inOut' as const,
        type: typeRef(v.type),
      })),
    ]
    // A native (C/C++, Python) block is surfaced under its own name, exactly
    // like every other library block. It briefly carried a `<library>__<name>`
    // prefix to keep two libraries' same-named blocks apart, but nothing else
    // in the system speaks that name: `resolveFunctionBlockPins` looks blocks
    // up by the manifest name, so a prefixed entry resolved to no pins and the
    // graphical editors could not build an instance for it. Name collisions
    // are settled the way they are everywhere else — the project's own POU
    // wins — rather than by giving native blocks a private namespace.
    const nativeLanguage = fb.implementation
    pous.push({
      name: fb.name,
      type: 'function-block',
      language: nativeLanguage ?? 'st',
      variables,
      body: nativeLanguage ? (sourceByFile.get(fb.sourceFile ?? '') ?? '') : '',
      documentation: fb.documentation ?? '',
      category: fb.category,
      ...executionControl,
      ...(fb.extends !== undefined ? { extends: fb.extends } : {}),
      ...(fb.implements !== undefined && fb.implements.length > 0 ? { implements: [...fb.implements] } : {}),
      ...(fb.isAbstract === true ? { isAbstract: true as const } : {}),
      ...(fb.methods !== undefined && fb.methods.length > 0 ? { methods: fb.methods.map(toMethod) } : {}),
    })
  }

  const interfaces: SystemLibraryInterface[] = (m.interfaces ?? []).map((iface) => ({
    name: iface.name,
    ...(iface.extends !== undefined && iface.extends.length > 0 ? { extends: [...iface.extends] } : {}),
    methods: iface.methods.map(toMethod),
    documentation: iface.documentation ?? '',
    ...(iface.category !== undefined ? { category: iface.category } : {}),
  }))

  const result: SystemLibrary = {
    name: m.name,
    author: '',
    version: m.version,
    stPath: '',
    cPath: '',
    pous,
  }
  if (m.displayName) result.displayName = m.displayName
  if (interfaces.length > 0) result.interfaces = interfaces
  return result
}

/**
 * @param bundledNames - the libraries that ship with the editor. Every other
 *   library's blocks get EN / ENO (`SystemLibraryPou.executionControl`); when
 *   omitted, none do.
 */
export function stlibsToSystemLibraries(archives: StlibArchiveDTO[], bundledNames?: Iterable<string>): SystemLibrary[] {
  const bundled = bundledNames === undefined ? undefined : new Set(bundledNames)
  return archives.map((archive) =>
    stlibToSystemLibrary(archive, {
      executionControl: bundled !== undefined && !bundled.has(archive.manifest.name),
    }),
  )
}
