/**
 * A debug key names a variable as Find references takes it: a global's (`Config0:`) or a program's own.
 */
import { xrefOfDebugKey } from '../xref-menu-items'

describe('xrefOfDebugKey', () => {
  it('maps Config0 keys to globals and other prefixes to their POU', () => {
    expect(xrefOfDebugKey('Config0:levelLimit.Trip')).toEqual({ pou: undefined, expression: 'levelLimit.Trip' })
    expect(xrefOfDebugKey('PUMP:dryRun')).toEqual({ pou: 'PUMP', expression: 'dryRun' })
    expect(xrefOfDebugKey('Config0:IO.din[2].q')).toEqual({ pou: undefined, expression: 'IO.din[2].q' })
  })
})
