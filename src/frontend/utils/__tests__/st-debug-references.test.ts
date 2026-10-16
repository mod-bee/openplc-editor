/**
 * findStReferences — the live references in a line of ST, resolved as the diagrams resolve a name.
 */
import { findStReferences } from '../st-debug-references'

/** Live keys by their resolved reference, upper case. */
const liveOf =
  (...live: string[]) =>
  (reference: string) =>
    live.find((key) => key.toUpperCase() === reference.toUpperCase())

describe('findStReferences', () => {
  it('finds a member and subscript reference as one span', () => {
    expect(findStReferences('x := IO.dout[DO_LAMP].q;', liveOf('IO.dout[DO_LAMP].q'))).toEqual([
      { key: 'IO.dout[DO_LAMP].q', startCol: 6, endCol: 24 },
    ])
  })

  it('reads a reference written with spaces as the same name', () => {
    expect(findStReferences('y := grid[ 1, 2 ] . v;', liveOf('grid[1,2].v'))).toEqual([
      { key: 'grid[1,2].v', startCol: 6, endCol: 22 },
    ])
  })

  it('falls back to the longest live prefix', () => {
    expect(findStReferences('z := motor.speed.raw;', liveOf('motor', 'motor.speed'))).toEqual([
      { key: 'motor.speed', startCol: 6, endCol: 17 },
    ])
  })

  it('skips names inside string literals and typed literals', () => {
    const resolve = liveOf('speed', 'T', 'INT', 's')
    expect(findStReferences("msg := 'speed'; x := T#5s; n := INT#3;", resolve)).toEqual([])
  })

  it('shows a key once per line, at its first reference', () => {
    expect(findStReferences('speed := speed + 1;', liveOf('speed'))).toHaveLength(1)
  })
})
