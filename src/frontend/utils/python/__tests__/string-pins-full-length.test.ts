/**
 * Python block STRING / WSTRING pins carry their whole declared length: the C
 * struct, the Python layout and the Python runtime agree on `[len u16][units]`.
 */
import { execFileSync } from 'node:child_process'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { generateSTCode } from '../generateSTCode'
import { injectPythonRuntime } from '../injectPythonRuntime'
import { pythonShmRuntime } from '../python-shm-runtime'
import { describeShmBaseType, SHM_STRING, SHM_WSTRING } from '../shm-type-map'

const pin = (name: string, cls: PLCVariable['class'], type: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: type },
  location: '',
  documentation: '',
  debug: false,
})

const arrayPin = (name: string, type: string): PLCVariable => ({
  name,
  class: 'input',
  type: {
    definition: 'array',
    value: `ARRAY [0..1] OF ${type}`,
    data: { baseType: { definition: 'base-type', value: type }, dimensions: [{ dimension: '0..1' }] },
  },
  location: '',
  documentation: '',
  debug: false,
})

const calcsize = (format: string): number =>
  Number(execFileSync('python3', ['-c', `import struct;print(struct.calcsize(${JSON.stringify(format)}))`]).toString())

describe('Python string pins at full declared length', () => {
  it('sizes each field from its declared length, with a 16-bit length prefix', () => {
    const s = describeShmBaseType('STRING(320)')
    expect(s).toMatchObject({ kind: 'string', chars: 320, size: 2 + 320, pyFormat: 'H320s' })
    const w = describeShmBaseType('WSTRING(300)')
    expect(w).toMatchObject({ kind: 'wstring', chars: 300, size: 2 + 600, pyFormat: 'H600s' })
    expect(SHM_STRING).toMatchObject({ chars: 254, size: 256 })
    expect(SHM_WSTRING).toMatchObject({ chars: 254, size: 2 + 508 })
    expect(calcsize(`=${s?.pyFormat ?? ''}`)).toBe(s?.size)
    expect(calcsize(`=${w?.pyFormat ?? ''}`)).toBe(w?.size)
  })

  it('declares a packed C field of the same width', () => {
    const st = generateSTCode({
      pouName: 'p',
      allVariables: [pin('msg', 'input', 'STRING(320)'), pin('w', 'output', 'WSTRING(300)')],
      processedPythonCode: '',
    })
    expect(st).toContain('#define STR_LEN_TYPE uint16_t')
    expect(st).toMatch(/__strlen_t len;\s*uint8_t body\[320\];\s*\} shm_iec_string_320_t;/)
    expect(st).toMatch(/__strlen_t len;\s*uint16_t body\[300\];\s*\} shm_iec_wstring_300_t;/)
    expect(st).toContain('shm_iec_string_320_t msg;')
    expect(st).not.toContain('STR_MAX_LEN')
    // Write-back is whole: the transport is as wide as the variable.
    expect(st).toContain('W = decltype(W.get())(reinterpret_cast<const char16_t*>(data_out.w.body)')
  })

  it('an ARRAY OF STRING(320) carries 320 per element', () => {
    const st = generateSTCode({
      pouName: 'p',
      allVariables: [arrayPin('lines', 'STRING(320)')],
      processedPythonCode: '',
    })
    expect(st).toContain('shm_iec_string_320_t lines_0;')
  })

  it('the Python layout row is as wide as the C field', () => {
    const py = injectPythonRuntime({
      inputVariables: [pin('msg', 'input', 'STRING(320)')],
      outputVariables: [],
      originalCode: '',
      pouName: 'p',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })
    expect(py).toContain(`(('msg',), (None,), 'str', 0, 322, None)`)
  })

  it('the Python runtime round-trips a 300-character value', () => {
    const script = `${pythonShmRuntime()}
buf = bytearray(2 + 320 + 2 + 600)
_shm_put(buf, 'str', 0, 322, 'x' * 300)
_shm_put(buf, 'wstr', 322, 602, 'Ω' * 299)
a = _shm_get(buf, 'str', 0, 322)
b = _shm_get(buf, 'wstr', 322, 602)
print(len(a), a == 'x' * 300, len(b), b == 'Ω' * 299, buf[0] | (buf[1] << 8))
`
    const out = execFileSync('python3', ['-c', `import struct\n${script}`])
      .toString()
      .trim()
    expect(out).toBe('300 True 299 True 300')
  })
})
