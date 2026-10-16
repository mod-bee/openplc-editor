/**
 * What an end-to-end test may reach in the renderer, and only when the main process was started with
 * OPENPLC_E2E=1 (the preload passes that on as `window.openplcE2E`; a normal run never sets it).
 *
 * `e2e/debug-display.spec.ts` uses it to show a debug session's values on a real project without a PLC:
 * it builds the debug tree from the project's debug map with the editor's own code and fills the values,
 * so the diagrams render exactly as they do online and can be looked at.
 */
import type { OpenPLCStore } from './store'
import { buildDebugVariableTreeMap, debugMapToEntries, deriveVariableIndexMap } from './utils/debugger-session'

export interface OpenPLCE2EHook {
  store: OpenPLCStore
  buildDebugVariableTreeMap: typeof buildDebugVariableTreeMap
  debugMapToEntries: typeof debugMapToEntries
  deriveVariableIndexMap: typeof deriveVariableIndexMap
}

declare global {
  interface Window {
    __openplcE2E?: OpenPLCE2EHook
  }
}

export function installE2EHook(store: OpenPLCStore): void {
  if (window.openplcE2E !== true) return
  window.__openplcE2E = { store, buildDebugVariableTreeMap, debugMapToEntries, deriveVariableIndexMap }
}
