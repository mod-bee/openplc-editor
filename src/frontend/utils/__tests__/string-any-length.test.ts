/**
 * STRING / WSTRING of any declared length, 1 to 65535 (IEC 61131-3 6.4.2.2,
 * Table 10 footnote k): every entry point gives the same base-type.
 */
import { blockVariantVariableSchema } from '../../../middleware/shared/ports/block-types'
import { baseTypeSchema } from '../../../middleware/shared/ports/plc-schemas'
import { parseArrayType, parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { lookupBaseType, MAX_STRING_LENGTH, parseStringLength } from '../iec-types-registry'
import { walkDebugResponse } from '../debug-response-walker'
import { classifyType, ELEMENTARY_TYPE_CONTEXT } from '../PLC/variable-declarations'
import { DEBUG_STRING_CAP, encodeForceValue, parseValueByTypeName } from '../variable-sizes'
import { baseTypeElementBody } from '../PLC/xml-generator/base-type-tag'
import { parseTypeXml } from '../PLC/xml-parser/type-xml'

describe('STRING of any declared length', () => {
  describe('registry (E1)', () => {
    it('allows 65535 code units', () => {
      expect(MAX_STRING_LENGTH).toBe(65535)
    })

    it.each(['STRING(255)', 'STRING(320)', 'WSTRING(300)', 'STRING(65535)', 'WSTRING(65535)'])('accepts %s', (t) => {
      expect(parseStringLength(t).valid).toBe(true)
      expect(lookupBaseType(t)).toBeDefined()
    })

    it.each(['STRING(0)', 'STRING(65536)', 'WSTRING(70000)'])('refuses %s', (t) => {
      expect(parseStringLength(t).valid).toBe(false)
      expect(lookupBaseType(t)).toBeUndefined()
    })
  })

  describe('schemas and parsers give a base-type (E2)', () => {
    it('base-type schema keeps the length', () => {
      expect(baseTypeSchema.parse('string(320)')).toBe('STRING(320)')
      expect(baseTypeSchema.parse('WSTRING[65535]')).toBe('WSTRING(65535)')
      expect(baseTypeSchema.safeParse('STRING(65536)').success).toBe(false)
    })

    it('library block pin schema takes STRING(320)', () => {
      const pin = { name: 'TEXT', class: 'input', type: { definition: 'base-type', value: 'STRING(320)' } }
      const parsed = blockVariantVariableSchema.safeParse(pin)
      expect(parsed.success).toBe(true)
    })

    it('declaration scanner', () => {
      expect(classifyType('STRING(320)', ELEMENTARY_TYPE_CONTEXT)).toEqual({
        definition: 'base-type',
        value: 'STRING(320)',
      })
    })

    it('VAR text parser', () => {
      const [v] = parseIecStringToVariables('VAR\n  msg : WSTRING(1000);\nEND_VAR')
      expect(v.type).toEqual({ definition: 'base-type', value: 'WSTRING(1000)' })
    })

    it('ARRAY OF STRING(320) element is a base-type (E6)', () => {
      const t = parseArrayType('ARRAY[0..3] OF STRING(320)')
      expect(t?.data?.baseType).toEqual({ definition: 'base-type', value: 'STRING(320)' })
      const [v] = parseIecStringToVariables('VAR\n  lines : ARRAY[0..3] OF STRING(320);\nEND_VAR')
      expect(v.type.data?.baseType).toEqual({ definition: 'base-type', value: 'STRING(320)' })
    })

    it('PLCopen XML round trip keeps the length', () => {
      expect(baseTypeElementBody('STRING(320)')).toEqual({ '@length': '320' })
      expect(parseTypeXml({ string: { '@length': '320' } })).toEqual({ definition: 'base-type', value: 'STRING(320)' })
      expect(parseTypeXml({ wstring: { '@length': '65535' } })).toEqual({
        definition: 'base-type',
        value: 'WSTRING(65535)',
      })
    })
  })

  describe('force and write (E5)', () => {
    it('forces a STRING(320) with up to 126 characters, in the 127-byte window', () => {
      const buf = encodeForceValue('hello', 'STRING(320)')
      expect(buf.length).toBe(1 + DEBUG_STRING_CAP)
      expect(Array.from(buf.subarray(0, 6))).toEqual([5, 104, 101, 108, 108, 111])
    })

    it('says why a longer value is refused, whatever the declared length', () => {
      expect(() => encodeForceValue('x'.repeat(127), 'STRING(320)')).toThrow(
        /too long: 127 characters \(max 126\).*126 characters.*any declared length/,
      )
    })

    it('forces a WSTRING(300) as UTF-16 code units in the 253-byte window', () => {
      const buf = encodeForceValue("'Ωk'", 'WSTRING(300)')
      expect(buf.length).toBe(1 + DEBUG_STRING_CAP * 2)
      expect(Array.from(buf.subarray(0, 5))).toEqual([2, 0xa9, 0x03, 0x6b, 0x00])
      expect(() => encodeForceValue('w'.repeat(127), 'WSTRING(300)')).toThrow(/max 126/)
    })
  })

  describe('watch window', () => {
    const windowOf = (text: string): Uint8Array => {
      const buf = new Uint8Array(1 + DEBUG_STRING_CAP)
      buf[0] = text.length
      for (let i = 0; i < text.length; i++) buf[1 + i] = text.charCodeAt(i)
      return buf
    }

    it('marks a STRING whose 126-character window is full', () => {
      expect(parseValueByTypeName(windowOf('y'.repeat(126)), 0, 'STRING(320)').windowFull).toBe(true)
      expect(parseValueByTypeName(windowOf('short'), 0, 'STRING(320)').windowFull).toBeUndefined()
    })

    it('the walker hands the mark on', () => {
      const payload = new Uint8Array([...windowOf('y'.repeat(126)), ...windowOf('n')])
      const seen: Array<boolean | undefined> = []
      walkDebugResponse({
        requested: [1, 2],
        payload,
        lastIndex: undefined,
        endian: 'le',
        typeOf: () => ({ type: 'STRING', meta: null }),
        emit: ({ windowFull }) => seen.push(windowFull),
      })
      expect(seen).toEqual([true, undefined])
    })
  })
})
