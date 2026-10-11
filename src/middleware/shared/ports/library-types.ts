export type LibraryPouType = 'function' | 'function-block'
/** Body language as the library presents it to consumers.  `cpp` and
 *  `python` surface native function blocks: strucpp doesn't compile
 *  those, it carries the authored source and the consumer's program
 *  build grafts them into the project's own native-POU pipeline (see
 *  `backend/shared/library/inject-library-blocks.ts`).  ST/IL/LD/SFC/FBD
 *  libraries are strucpp-compiled and the chunks ride the manifest
 *  entries. */
export type LibraryLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'cpp' | 'python'

export interface SystemLibraryVariable {
  name: string
  /**
   * Pin role on the resulting block:
   *  - `input` / `output` for normal pins
   *  - `inOut` (camelCase) for IEC `VAR_IN_OUT` pins, which read/write
   *    through a single bidirectional connection
   *  - `local` for FB-internal state surfaced for inspection (rare in
   *    library-supplied entries; primarily used by user-authored POUs)
   */
  class: 'input' | 'output' | 'local' | 'inOut'
  type:
    | { definition: 'base-type'; value: string }
    | { definition: 'derived-type'; value: string }
    | { definition: 'generic-type'; value: string }
  location?: string
  initialValue?: unknown
  documentation?: string
  /**
   * `R_EDGE` / `F_EDGE` on a BOOL input (IEC 61131-3 6.6.3.2 item 13): the
   * block acts on the input's rising / falling edge. Drawn with the edge
   * marker on the pin.
   */
  edge?: 'R_EDGE' | 'F_EDGE'
}

export interface SystemLibraryPou {
  name: string
  type: LibraryPouType
  language: LibraryLanguage
  variables: SystemLibraryVariable[]
  /**
   * Body source text. Reserved for future preview / code-completion
   * tooling; the library tree itself never reads it. Defaults to `''`
   * for `.stlib`-sourced libraries since strucpp keeps the canonical
   * body alongside compiled output, not in the manifest.
   */
  body: string
  documentation: string
  /**
   * IEC-style extensible (variadic) function: ADD/MUL/AND/MUX accept any
   * number of additional pins past the declared parameter list. The
   * graphical editors render a "+" handle to grow inputs when this is
   * set; type-checking unifies all extra pins with the trailing
   * declared parameter's type.
   */
  extensible?: boolean
  /**
   * Slash-separated folder path inside the originating library (e.g.
   * `"POUs/Time&Date"` for an OSCAT FB, `"Arithmetic"` for an std
   * function). Empty/undefined puts the entry at the library root.
   * Comes straight from the .stlib manifest's per-entry `category`
   * field — see strucpp's library-manifest contract.
   */
  category?: string
  /**
   * The block always shows EN / ENO in Ladder and FBD (IEC 61131-3 6.6.1.5,
   * Table 18; decision 50): the rung drives EN and continues from ENO, and a
   * data pin is never fed by the rung. Set on every block of an installed
   * library. The bundled IEC blocks keep the classic form in which the rung
   * runs through their first BOOL input and output (8.2.6 b), so a TON's IN
   * still takes the rung.
   */
  executionControl?: true
  /** The block it EXTENDS (IEC 61131-3 6.6.5.5); its pins already include the base's. */
  extends?: string
  /** The interfaces it names in IMPLEMENTS (6.6.6.4); its bases' are theirs. */
  implements?: string[]
  /** An ABSTRACT block (6.6.5.8.2): a base for others, never placed or declared. */
  isAbstract?: true
  /** Its PUBLIC methods, own and inherited (6.6.5.4.4). */
  methods?: SystemLibraryMethod[]
}

/** A method prototype of a library block or interface (IEC 61131-3 6.6.5.4). */
export interface SystemLibraryMethod {
  name: string
  /** Absent for a method that returns nothing. */
  returnType?: string
  variables: SystemLibraryVariable[]
}

/**
 * A library INTERFACE (IEC 61131-3 6.6.6): a type a variable or an input pin
 * can have, taking an instance of any block that implements it. Never placed
 * as a block.
 */
export interface SystemLibraryInterface {
  name: string
  /** The interfaces it EXTENDS (6.6.6.6). */
  extends?: string[]
  /** Its own method prototypes. */
  methods: SystemLibraryMethod[]
  documentation: string
  category?: string
}

export interface SystemLibrary {
  name: string
  /**
   * Human-readable label rendered in the library tree as the root
   * folder title (e.g. "Standard Function Blocks" instead of the
   * kebab-case `iec-standard-fb` identifier). Falls back to `name`
   * when the source .stlib doesn't ship one.
   */
  displayName?: string
  author: string
  version: string
  stPath: string
  cPath: string
  pous: SystemLibraryPou[]
  /** The library's interfaces; absent when it declares none. */
  interfaces?: SystemLibraryInterface[]
}

export interface UserLibrary {
  name: string
  type: 'function' | 'function-block' | 'program'
}

export type LibraryState = {
  libraries: {
    system: SystemLibrary[]
    user: UserLibrary[]
  }
}

// ---------------------------------------------------------------------------
// Library Manager wire types
// ---------------------------------------------------------------------------

/**
 * One row in the system-wide library pool the manager surfaces.
 * Mirrors the shape `PackageManagerModule` uses for hardware plugins,
 * adapted to library identity.
 *
 * `bundled: true` marks libraries that ship with strucpp itself
 * (everything in `<resources>/strucpp/libs/`) — they're the
 * canonical, non-disableable IEC base set and grow whenever a future
 * strucpp release bundles more.  User-installed libraries (.stlib or
 * .lib/.library) all surface with `bundled: false`.
 */
export interface InstalledLibrary {
  /** The strucpp manifest `name` — same identifier projects record
   *  in `project.json`'s `libraries[]` and the value the system pool
   *  is keyed on. */
  name: string
  version: string
  bundled: boolean
  /** ISO timestamp; empty string for bundled libs (which have no
   *  meaningful "installed at" — they ship with the editor). */
  installedAt: string
  /** Source the user installed from.  `'stlib'` for direct archive
   *  imports, `'codesys'` when the editor ran the .lib/.library
   *  through strucpp's CODESYS importer.  `'bundled'` for the
   *  always-on set. */
  origin: 'stlib' | 'codesys' | 'bundled'
  /** Optional human-readable label from the manifest.  Falls back
   *  to `name` in the UI. */
  /** Every installed version of this library, newest first.  `version`
   *  above is the first of these.  Absent for bundled libraries, which
   *  ship one build with the editor. */
  versions?: string[]
  displayName?: string
  /** Optional manifest descriptions surfaced in the manager's
   *  details panel.  Subset of the `.stlib` manifest — only the
   *  fields the UI renders are pinned, so adding fields to the
   *  archive doesn't ripple through every consumer. */
  description?: string
  author?: string
}

/**
 * Result of a system-pool install attempt — both the .stlib and
 * .lib/.library paths funnel through this shape so the renderer
 * doesn't branch on origin.
 */
export type LibraryInstallResult = LibrarySingleInstallResult | LibraryBundleInstallResult

/** Installing one archive: what every path except a ZIP returns. */
export type LibrarySingleInstallResult =
  | {
      success: true
      /** True when the user closed the file picker without choosing
       *  a file.  The renderer treats this as a no-op (no toast, no
       *  error). */
      canceled?: false
      /** The installed library's identifier — caller can immediately
       *  pivot the manager UI to its details. */
      name: string
      version: string
      origin: 'stlib' | 'codesys'
    }
  | { success: true; canceled: true }
  | { success: false; error: string }

/** One `.stlib` inside a ZIP, and what installing it did. */
export type LibraryBundleEntry =
  | { path: string; success: true; name: string; version: string; origin: 'stlib' | 'codesys' }
  | { path: string; success: false; error: string }

/**
 * A ZIP holds several archives, so one of them failing says nothing about the
 * rest: each is installed on its own and reported on its own. `success` is
 * true whenever at least one landed — the caller refreshes for those and
 * surfaces `failed` for the others. Narrow with `'entries' in result`.
 */
export interface LibraryBundleInstallResult {
  success: true
  canceled?: false
  /** Every `.stlib` the ZIP held, in the order they were installed. */
  entries: LibraryBundleEntry[]
  /** The ones that installed, so the caller can select one and refresh. */
  installed: Array<{ name: string; version: string }>
  /** The ones that did not, each naming its entry path. */
  failed: Array<{ path: string; error: string }>
}

/** A project's reference to a library: a name, optionally pinned to a version. */
export interface LibraryRef {
  name: string
  version?: string
}

/** The pinned version was not installed, so a different one was used. */
export interface VersionSubstitution {
  name: string
  wanted: string
  used: string
}

/** What a compile gets for the libraries a project enables.
 *  Parameterised so the resolver can keep its parsed archive type while the
 *  IPC boundary, which cannot, stays on `unknown`. */
export interface EnabledArchives<Archive = unknown> {
  archives: Archive[]
  /** Enabled names no archive could be resolved for. */
  missing: string[]
  /** Resolved, but not to the version the project pins. */
  substituted: VersionSubstitution[]
}
