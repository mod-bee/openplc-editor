/**
 * Attribute pragmas on a declaration (CODESYS `{attribute 'hide'}`): read as
 * written, kept through every table edit, and moved and deleted with the
 * variable they decorate.
 */
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { attributeProblem, parseAttributePragmas, renderAttributePragma } from '../PLC/attribute-pragmas'
import { parseTextualPouFromString } from '../PLC/pou-text-parser'
import { serializeTextualPouToString } from '../PLC/pou-text-serializer'
import { parseVariableDeclarations } from '../PLC/variable-declarations'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { applyVariablesToText } from '../variable-text-edits'

const TEXT = [
  'VAR',
  '    nShown : INT;',
  '    (* the working copy *)',
  "    {attribute 'hide'}",
  "    {attribute 'conditionalShow' := 'Debug'}",
  '    nWork : INT := 3; (* scratch *)',
  "    {attribute 'hide'} nInline : DINT;",
  '    bLast : BOOL;',
  'END_VAR',
].join('\n')

const declarations = (text: string) => parseVariableDeclarations(text, {}).blocks.flatMap((block) => block.declarations)
const vars = (text: string): PLCVariable[] => declarations(text).map((d) => d.variable)
const byName = (text: string, name: string) => vars(text).find((v) => v.name === name)

describe('reading attribute pragmas', () => {
  it('keeps each one as written, value included, in source order', () => {
    expect(byName(TEXT, 'nWork')?.attributes).toEqual([{ name: 'hide' }, { name: 'conditionalShow', value: 'Debug' }])
    expect(byName(TEXT, 'nInline')?.attributes).toEqual([{ name: 'hide' }])
    expect(byName(TEXT, 'nShown')).not.toHaveProperty('attributes')
    expect(byName(TEXT, 'bLast')).not.toHaveProperty('attributes')
  })

  it('still finds the comment above the pragmas, and the trailing one', () => {
    const work = byName(TEXT, 'nWork')
    expect(work?.leadingComment).toBe('the working copy')
    expect(work?.documentation).toBe('scratch')
    expect(work?.initialValue).toBe('3')
  })

  it('applies one pragma to every name of a shared declaration', () => {
    const text = "VAR\n    {attribute 'hide'}\n    a, b : INT;\nEND_VAR"
    expect(vars(text).map((v) => v.attributes)).toEqual([[{ name: 'hide' }], [{ name: 'hide' }]])
  })

  it('reads a pragma set apart by a blank line as STruC++ does, in its folded spelling', () => {
    const text = "VAR\n    {attribute 'Hide'}\n\n    a : INT;\nEND_VAR"
    expect(byName(text, 'a')?.attributes).toEqual([{ name: 'hide' }])
  })
})

describe('writing them back', () => {
  it('serialises them between the comment and the declaration, and reads back the same', () => {
    const out = generateIecVariablesToString([
      {
        name: 'nWork',
        class: 'local',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
        leadingComment: 'note',
        attributes: [{ name: 'hide' }, { name: 'conditionalshow', value: 'x' }],
      },
    ])
    expect(out).toContain(
      "(* note *)\n    {attribute 'hide'}\n    {attribute 'conditionalshow' := 'x'}\n    nWork : INT;",
    )
    expect(byName(out, 'nWork')?.attributes).toEqual([{ name: 'hide' }, { name: 'conditionalshow', value: 'x' }])
  })

  it('leaves the text alone when nothing changed', () => {
    expect(applyVariablesToText(TEXT, vars(TEXT))).toBe(TEXT)
  })

  it('adds, changes and removes pragmas in place', () => {
    const next = vars(TEXT).map((v) =>
      v.name === 'nShown'
        ? { ...v, attributes: [{ name: 'hide' }] }
        : v.name === 'nWork'
          ? { ...v, attributes: [{ name: 'hide' }] }
          : v.name === 'nInline'
            ? { ...v, attributes: [] }
            : v,
    )
    const out = applyVariablesToText(TEXT, next)
    expect(out).toBe(
      [
        'VAR',
        "    {attribute 'hide'}",
        '    nShown : INT;',
        '    (* the working copy *)',
        "    {attribute 'hide'}",
        '    nWork : INT := 3; (* scratch *)',
        '    nInline : DINT;',
        '    bLast : BOOL;',
        'END_VAR',
      ].join('\n'),
    )
  })

  it('leaves the pragmas alone when the update does not mention them', () => {
    const next = vars(TEXT).map((v) => {
      const { attributes: _dropped, ...rest } = v
      return rest
    })
    expect(applyVariablesToText(TEXT, next)).toBe(TEXT)
  })

  it('deletes them with their variable', () => {
    const out = applyVariablesToText(
      TEXT,
      vars(TEXT).filter((v) => v.name !== 'nWork'),
    )
    expect(out).not.toContain('working copy')
    expect(out).not.toContain('conditionalShow')
    expect(byName(out, 'nInline')?.attributes).toEqual([{ name: 'hide' }])
  })

  it('moves them with their variable', () => {
    const [shown, work, inline, last] = vars(TEXT)
    const out = applyVariablesToText(TEXT, [work, shown, inline, last])
    expect(out.split('\n').slice(1, 5)).toEqual([
      '    (* the working copy *)',
      "    {attribute 'hide'}",
      "    {attribute 'conditionalShow' := 'Debug'}",
      '    nWork : INT := 3; (* scratch *)',
    ])
    expect(byName(out, 'nShown')).not.toHaveProperty('attributes')
  })

  it('puts a new comment above the pragmas', () => {
    const text = "VAR\n    {attribute 'hide'}\n    a : INT;\nEND_VAR"
    const out = applyVariablesToText(text, [{ ...vars(text)[0], leadingComment: 'why' }])
    expect(out).toBe("VAR\n    (* why *)\n    {attribute 'hide'}\n    a : INT;\nEND_VAR")
  })

  it('writes a new variable with its pragmas', () => {
    const text = 'VAR\n    a : INT;\nEND_VAR'
    const out = applyVariablesToText(text, [
      ...vars(text),
      {
        name: 'b',
        class: 'local',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        documentation: '',
        attributes: [{ name: 'hide' }],
      },
    ])
    expect(out).toBe("VAR\n    a : INT;\n    {attribute 'hide'}\n    b : BOOL;\nEND_VAR")
  })

  it('replaces lines above and a pragma on the line together', () => {
    const text = "VAR\n    {attribute 'a'}\n    {attribute 'b'} x : INT;\nEND_VAR"
    expect(byName(text, 'x')?.attributes).toEqual([{ name: 'a' }, { name: 'b' }])
    const out = applyVariablesToText(text, [{ ...vars(text)[0], attributes: [{ name: 'hide' }] }])
    expect(out).toBe("VAR\n    {attribute 'hide'}\n    x : INT;\nEND_VAR")
  })
})

describe('the pragma text', () => {
  it('renders and parses both forms', () => {
    const text = `${renderAttributePragma({ name: 'hide' })} ${renderAttributePragma({ name: 'm', value: 'v w' })}`
    expect(text).toBe("{attribute 'hide'} {attribute 'm' := 'v w'}")
    expect(parseAttributePragmas(text)).toEqual([{ name: 'hide' }, { name: 'm', value: 'v w' }])
  })

  it('refuses what cannot be written', () => {
    expect(attributeProblem({ name: 'hide' })).toBeUndefined()
    expect(attributeProblem({ name: "it's" })).toMatch(/plain name/)
    expect(attributeProblem({ name: 'x', value: "a'b" })).toMatch(/quote/)
  })
})

describe('a POU file', () => {
  it('loads the pragmas into the model and saves the file unchanged', () => {
    const source = [
      'FUNCTION_BLOCK FB_Pump',
      '  VAR_INPUT',
      '    bRun : BOOL;',
      '  END_VAR',
      '  VAR',
      "    {attribute 'hide'}",
      '    tOn : TON;',
      '  END_VAR',
      '',
      '  tOn(IN := bRun, PT := T#1s);',
      '',
      'END_FUNCTION_BLOCK',
    ].join('\n')
    const pou = parseTextualPouFromString(source, 'st', 'function-block')
    expect(pou.interface?.variables.find((v) => v.name === 'tOn')?.attributes).toEqual([{ name: 'hide' }])
    expect(serializeTextualPouToString(pou)).toBe(
      serializeTextualPouToString(parseTextualPouFromString(serializeTextualPouToString(pou), 'st', 'function-block')),
    )
    expect(serializeTextualPouToString(pou)).toContain("    {attribute 'hide'}\n    tOn : TON;")
  })
})
