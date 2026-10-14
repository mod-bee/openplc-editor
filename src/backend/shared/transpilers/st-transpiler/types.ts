/**
 * Minimal IR consumed by the JSON-fed transpiler, decoupled from both the port shape and the
 * `project.json` schema shape via adapter helpers (`from-schema.ts`, `../transpile-from-port.ts`).
 * Carries only the fields the transpiler reads — no `servers`, `remoteDevices`, `libraries`, etc.
 */

/* ─────────────────────────── project ────────────────────────────────────── */

export interface TranspileProject {
  dataTypes: TranspileDataType[]
  /** The enabled libraries' STRUCT types, from their .stlib manifests. Only read to type a wire that
   *  reaches into a library type (`DEV.limit.set.sp`); they are emitted by the library, not here. */
  libraryTypes?: TranspileLibraryType[]
  pous: TranspilePou[]
  configuration: {
    tasks: TranspileTask[]
    instances: TranspileInstance[]
    globalVariables: TranspileVariable[]
  }
}

/** A library's STRUCT: each member's name and its type as ST text (`REAL`, `UT_SET`, `ARRAY [1..4] OF UT_STAGE`). */
export interface TranspileLibraryType {
  name: string
  fields: Array<{ name: string; type: string }>
}

/* ─────────────────────────── pou ────────────────────────────────────────── */

/** `interface`: an IEC 61131-3 INTERFACE (6.6.6), its method prototypes in the ST body. */
export type TranspilePouKind = 'program' | 'function' | 'function-block' | 'interface'
export type TranspileBodyLanguage = 'st' | 'il' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'

export interface TranspilePou {
  name: string
  pouType: TranspilePouKind
  documentation?: string
  /** Empty for POUs with no parameters / locals. */
  interface: TranspilePouInterface
  body: TranspileBody
}

export interface TranspilePouInterface {
  /** Only set on `function` POUs. */
  returnType?: string
  /**
   * Base function block, from `FUNCTION_BLOCK X EXTENDS Y`; on an interface,
   * the interfaces it EXTENDS, comma-separated.
   */
  extends?: string
  /** `IMPLEMENTS` list of a function block (IEC 61131-3 6.6.6.4). */
  implements?: string[]
  /** `FUNCTION_BLOCK ABSTRACT` / `FINAL` (6.6.5.8). */
  isAbstract?: boolean
  isFinal?: boolean
  variables: TranspileVariable[]
}

/**
 * Body payload, discriminated by `language`: textual languages carry raw source `value: string`;
 * graphical ('ld'/'fbd') carry the raw React Flow body the walker in `./walker/` consumes directly.
 */
export type TranspileBody =
  | {
      language: 'st' | 'il' | 'python' | 'cpp'
      value: string
    }
  | {
      language: 'ld'
      value: import('./walker/types').RFBody
    }
  | {
      language: 'fbd'
      value: import('./walker/fbd').RFFbdBody
    }

/* ──────────────────────────── variable ──────────────────────────────────── */

export type TranspileVariableClass = 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp'

export interface TranspileVariable {
  name: string
  type: TranspileVariableType
  class?: TranspileVariableClass
  /** IEC located address (`%QX0.0`, `%IW3`, …). */
  location?: string
  /** Raw initial-value text — caller-supplied, no quote-wrapping. */
  initialValue?: string
  documentation?: string
  /**
   * IEC block qualifier (absent = plain `VAR`). IEC puts the qualifier on the var *block*, so
   * this is a bucketing key for `computeInterface`'s emission, not a per-line annotation.
   */
  flag?: TranspileVariableFlag
  /** Access specifier of a function block `VAR` section (6.6.5.3); also a bucketing key. */
  access?: 'public' | 'protected' | 'private'
  /** `R_EDGE` / `F_EDGE` on a BOOL input (6.6.3.2 item 13). */
  edge?: 'rising' | 'falling'
}

/** Mirrors `VariableFlag` in middleware/shared/ports/types.ts. */
export type TranspileVariableFlag = 'constant' | 'retain' | 'non-retain'

/* ──────────────────────────── variable type ─────────────────────────────── */

/** `base-type` = elementary IEC type; `array` = `ARRAY [a..b, …] OF T`; `derived`/`user-data-type` = referenced data-type name. */
export type TranspileVariableType =
  | { definition: 'base-type'; value: string }
  | { definition: 'derived' | 'user-data-type'; value: string }
  | {
      definition: 'array'
      data: {
        dimensions: { dimension: string }[]
        baseType: string | { value: string }
      }
    }

/* ──────────────────────────── data type ─────────────────────────────────── */

export type TranspileDataType =
  | {
      name: string
      derivation: 'array'
      dimensions: { dimension: string }[]
      baseType: string | { value: string }
      initialValue?: string
    }
  | {
      name: string
      derivation: 'enumerated'
      /** Base type of a data type with named values (IEC 61131-3 Ed.3 6.4.4.3). */
      baseType?: string
      values: { description: string; value?: string }[]
      initialValue?: string
    }
  | {
      name: string
      derivation: 'structure'
      variable: TranspileVariable[]
      initialValue?: string
    }
  | {
      name: string
      derivation: 'directly-derived'
      baseType: string
      initialValue?: string
    }

/* ──────────────────────────── configuration ─────────────────────────────── */

export interface TranspileTask {
  name: string
  priority: number
  /** Triggering mode: 'Cyclic' uses `interval`; 'Interrupt' uses `single`. */
  triggering: 'Cyclic' | 'Interrupt'
  interval?: string
  /** Source signal expression for non-Cyclic tasks (mapped to SINGLE/MULTI). */
  single?: string
  /** CPU core; absent = Auto. Emitted as the IEC §6.2 pragma `{CORE := n}`. */
  core?: number
}

export interface TranspileInstance {
  /** Instance name (`instance0`). */
  name: string
  /** POU type the instance references (`main`). */
  program: string
  /** Task this instance binds to.  Empty / unset → no task assignment
   *  (instance lives directly under the resource). */
  task?: string
}
