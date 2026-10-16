// import './splash-screen/index'

import { contextBridge } from 'electron'

import rendererProcessBridge from '../ipc/renderer'

contextBridge.exposeInMainWorld('bridge', rendererProcessBridge)
// Only an end-to-end test run sets OPENPLC_E2E; see src/frontend/e2e-hook.ts.
contextBridge.exposeInMainWorld('openplcE2E', process.env.OPENPLC_E2E === '1')

export type ElectronHandler = typeof rendererProcessBridge

declare global {
  interface Window {
    bridge: ElectronHandler
    /** True only in an end-to-end test run (OPENPLC_E2E=1). */
    openplcE2E?: boolean
  }
}
