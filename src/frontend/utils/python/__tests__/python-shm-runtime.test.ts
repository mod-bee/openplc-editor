import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pythonShmRuntime } from '../python-shm-runtime'

/**
 * The runtime is the half of the generated `.py` that must NOT vary by project.
 * Pinning it byte-for-byte is what makes "identical in every build" a fact
 * rather than an intention: any edit to the emitted Python has to be made
 * deliberately, in the fixture too, and the fixture is what the Python-level
 * round-trip test executes.
 */
describe('pythonShmRuntime', () => {
  const fixture = readFileSync(join(__dirname, 'fixtures/python-shm-runtime.fixture.py'), 'utf-8')

  it('is byte-identical to the checked-in fixture', () => {
    expect(pythonShmRuntime()).toBe(fixture)
  })

  it('emits no percent sign, which the loader would read as a format directive', () => {
    // `python_block_loader` writes the script with
    // `fprintf(fp, script_content, pid, shm_name, shm_name)`, so the generated
    // `.py` IS the format string. A literal percent here is a conversion
    // directive: a malformed one is undefined behaviour, and a well-formed one
    // (`%s`) consumes a vararg and segfaults the runtime. This text ships in
    // every block, so the safe number is zero.
    expect(pythonShmRuntime()).not.toContain('%')
  })

  it('takes each string field capacity from its layout row, not from a fixed cap', () => {
    // A field carries its whole declared length; the row's size is the only place it is stated.
    expect(pythonShmRuntime()).not.toContain('_STR_CHARS')
    expect(pythonShmRuntime()).toContain('def _shm_get(buf, kind, off, size):')
  })

  it('contains no project-specific text', () => {
    const emitted = pythonShmRuntime()
    // Every name it defines is generic; nothing is per-variable or per-POU.
    expect(emitted).not.toMatch(/_SHM_(IN|OUT)\s*=/)
    expect(emitted).toContain('def _shm_unpack(buf, layout, scope):')
    expect(emitted).toContain('def _shm_pack(buf, layout, scope):')
  })
})
