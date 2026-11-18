import { parseStringLength } from '../../../frontend/utils/iec-types-registry'

/** `STRING(320)` saved as a user-data-type, as the base-type it is; `null` when it is anything else. */
function liftedType(node: object): { definition: 'base-type'; value: string } | null {
  if (!('definition' in node) || !('value' in node)) return null
  if (node.definition !== 'user-data-type' || typeof node.value !== 'string') return null
  const { base, length, valid } = parseStringLength(node.value)
  if (length === undefined || !valid) return null
  return { definition: 'base-type', value: `${base}(${length})` }
}

/**
 * Turn every `{definition: 'user-data-type', value: 'STRING(n)'}` (or WSTRING) in a
 * loaded project tree into a base-type. An editor that allowed only 254 kept longer
 * declarations that way. Returns the input itself when nothing changes. Idempotent.
 */
export function liftSizedStringTypes<T>(value: T): T
export function liftSizedStringTypes(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value
    let changed = false
    const out = items.map((item) => {
      const next = liftSizedStringTypes(item)
      if (next !== item) changed = true
      return next
    })
    return changed ? out : items
  }
  if (value === null || typeof value !== 'object') return value

  const lifted = liftedType(value)
  if (lifted) return { ...value, ...lifted }

  let out: Record<string, unknown> | undefined
  const entries: Array<[string, unknown]> = Object.entries(value)
  for (const [key, child] of entries) {
    const next = liftSizedStringTypes(child)
    if (next === child) continue
    out ??= { ...value }
    out[key] = next
  }
  return out ?? value
}
