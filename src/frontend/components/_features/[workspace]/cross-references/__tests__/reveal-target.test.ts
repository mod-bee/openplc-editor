/**
 * Go to from a cross reference marks the pin: the pin a variable is wired to, or the asked-for member's
 * pin at a block call (`levelLimit.LoLo` at `levelLimit`'s call: the LoLo pin).
 */
import type { XrefTarget, XrefUse } from '../../../../../utils/project-xref'
import { revealTargetOf } from '..'

const use = (over: Partial<XrefUse>): XrefUse => ({
  pou: 'LEVEL',
  language: 'ld',
  owner: 'GLOBAL',
  expression: 'levelLimit',
  path: 'LEVELLIMIT',
  access: 'call',
  element: 'block',
  detail: 'UT_LIMIT block',
  rungId: 'r3',
  rungIndex: 3,
  nodeId: 'blk',
  ...over,
})
const target = (path: string): XrefTarget => ({ owner: 'GLOBAL', root: 'levelLimit', expression: path, path: path.toUpperCase() })

describe('revealTargetOf', () => {
  it("marks the asked-for member's pin at a block call", () => {
    expect(revealTargetOf(use({}), target('levelLimit.LoLo'))).toMatchObject({ nodeId: 'blk', blockId: 'blk', pin: 'LOLO' })
  })

  it('marks the block alone when the whole variable was asked for', () => {
    const t = revealTargetOf(use({}), target('levelLimit'))
    expect(t).toMatchObject({ nodeId: 'blk' })
    expect(t).not.toHaveProperty('pin')
  })

  it('marks the pin a variable element sits on', () => {
    const t = revealTargetOf(
      use({ access: 'read', element: 'variable', nodeId: 'v1', blockId: 'motor1', pin: 'Reset', expression: 'resetAll' }),
      target('resetAll'),
    )
    expect(t).toMatchObject({ nodeId: 'v1', blockId: 'motor1', pin: 'Reset' })
  })
})
