/**
 * The IEC 61131-3 object-oriented declarations in the editor's own readers
 * and writers (6.6.5 function blocks with methods and inheritance, 6.6.6
 * interfaces), each in isolation:
 *
 * - the POU reader keeps a block's METHODs with its body, ahead of its
 *   statements, whatever VAR sections the methods declare;
 * - the declaration parser keeps `VAR PROTECTED`, `NON_RETAIN` and `R_EDGE`,
 *   and the writer emits them again;
 * - assignability between instances, bases and interfaces (6.6.6.5.1);
 * - the library splitter finds `FUNCTION_BLOCK ABSTRACT` and `INTERFACE`;
 * - the linter treats every method as a scope of its own.
 */

import { splitProgramSt } from '@root/backend/shared/utils/PLC/split-program-st'
import { lintProgram } from '@root/cli/lint/program'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCPou } from '@root/middleware/shared/ports/types'

import { generateIecVariablesToString } from '../../generate-iec-variables-to-string'
import { buildLibraryTree } from '../../library-tree'
import { buildOopTypeIndex, isAbstractBlock, isOopAssignable } from '../oop-types'
import { parseTextualPouFromString } from '../pou-text-parser'
import { serializeTextualPouToString } from '../pou-text-serializer'
import { parseVariableDeclarations } from '../variable-declarations'

const FB_WITH_METHODS = `FUNCTION_BLOCK FINAL Valve EXTENDS ValveBase IMPLEMENTS I_Valve, I_Status
  VAR_INPUT
    Open : BOOL R_EDGE; (* open on the press *)
  END_VAR
  VAR PROTECTED
    moving : BOOL;
  END_VAR
  (* a METHOD mentioned in a comment is not one *)
  METHOD PUBLIC IsOpen : BOOL
    VAR_INPUT
      N : INT;
    END_VAR
    IsOpen := NOT moving;
  END_METHOD

  moving := Open;
END_FUNCTION_BLOCK`

describe('a function block with methods, read and written back', () => {
  const pou = parseTextualPouFromString(FB_WITH_METHODS, 'st', 'function-block')

  it('reads the header clauses', () => {
    expect(pou.interface?.extends).toBe('ValveBase')
    expect(pou.interface?.implements).toEqual(['I_Valve', 'I_Status'])
    expect(pou.interface?.isFinal).toBe(true)
  })

  it("keeps the methods' VAR sections out of the block's declarations", () => {
    expect(pou.interface?.variables.map((v) => [v.name, v.class, v.access, v.edge])).toEqual([
      ['Open', 'input', undefined, 'rising'],
      ['moving', 'local', 'protected', undefined],
    ])
    expect(pou.variablesText).not.toMatch(/METHOD/)
    const body = String(pou.body.value)
    expect(body.startsWith('(* a METHOD mentioned')).toBe(true)
    expect(body).toMatch(/METHOD PUBLIC IsOpen : BOOL[\s\S]*END_METHOD[\s\S]*moving := Open;$/)
  })

  it('writes the same declaration back', () => {
    const text = serializeTextualPouToString(pou)
    expect(text).toContain('FUNCTION_BLOCK FINAL Valve EXTENDS ValveBase IMPLEMENTS I_Valve, I_Status\n')
    const again = parseTextualPouFromString(text, 'st', 'function-block')
    expect(again.interface).toEqual(pou.interface)
    expect(again.body.value).toEqual(pou.body.value)
  })

  it('reads a block whose only declarations are in its methods', () => {
    const only = parseTextualPouFromString(
      'FUNCTION_BLOCK Probe\n  METHOD PUBLIC M : BOOL\n    VAR_INPUT x : BOOL; END_VAR\n    M := x;\n  END_METHOD\nEND_FUNCTION_BLOCK',
      'st',
      'function-block',
    )
    expect(only.interface?.variables).toEqual([])
    expect(String(only.body.value)).toMatch(/^METHOD PUBLIC M : BOOL/)
  })

  it('reads an interface: its prototypes are its body, it has no variables', () => {
    const iface = parseTextualPouFromString(
      'INTERFACE I_Motor EXTENDS I_Status, I_Named\n  METHOD Request : BOOL\n    VAR_INPUT On : BOOL; END_VAR\n  END_METHOD\nEND_INTERFACE',
      'st',
      'interface',
    )
    expect(iface.pouType).toBe('interface')
    expect(iface.interface?.extends).toBe('I_Status, I_Named')
    expect(iface.interface?.variables).toEqual([])
    expect(String(iface.body.value)).toMatch(/^METHOD Request : BOOL/)
    expect(serializeTextualPouToString(iface)).toMatch(/^INTERFACE I_Motor EXTENDS I_Status, I_Named\n/)
  })
})

describe('VAR section qualifiers and edge inputs', () => {
  const source = [
    'VAR_INPUT',
    '  Go : BOOL F_EDGE;',
    'END_VAR',
    'VAR NON_RETAIN',
    '  first : BOOL := TRUE;',
    'END_VAR',
    'VAR RETAIN PRIVATE',
    '  total : LREAL;',
    'END_VAR',
  ].join('\n')

  it('parses them into the model', () => {
    const parsed = parseVariableDeclarations(source)
    expect(parsed.errors).toEqual([])
    expect(parsed.variables.map((v) => [v.name, v.flag, v.access, v.edge])).toEqual([
      ['Go', undefined, undefined, 'falling'],
      ['first', 'non-retain', undefined, undefined],
      ['total', 'retain', 'private', undefined],
    ])
  })

  it('writes them back as IEC declares them', () => {
    const text = generateIecVariablesToString(parseVariableDeclarations(source).variables)
    expect(text).toContain('Go : BOOL F_EDGE;')
    expect(text).toMatch(/VAR NON_RETAIN\n\s+first : BOOL := TRUE;/)
    expect(text).toMatch(/VAR RETAIN PRIVATE\n\s+total : LREAL;/)
    // The writer orders blocks by class and qualifier, so compare by name.
    const byName = (list: ReturnType<typeof parseVariableDeclarations>['variables']) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name))
    expect(byName(parseVariableDeclarations(text).variables)).toEqual(
      byName(parseVariableDeclarations(source).variables),
    )
  })
})

describe('assignability through interfaces and inheritance (6.6.6.5.1)', () => {
  const library = {
    name: 'lib',
    author: '',
    version: '1',
    stPath: '',
    cPath: '',
    interfaces: [
      { name: 'I_STATUS', methods: [], documentation: '' },
      { name: 'I_MOTOR', extends: ['I_STATUS'], methods: [], documentation: '' },
    ],
    pous: [
      { name: 'MOTOR', type: 'function-block', implements: ['I_MOTOR'], variables: [] },
      { name: 'MOTOR_VSD', type: 'function-block', extends: 'MOTOR', variables: [] },
      { name: 'BASE', type: 'function-block', isAbstract: true, variables: [] },
      { name: 'PLAIN', type: 'function-block', variables: [] },
    ],
  } as unknown as SystemLibrary
  const project = [
    { name: 'MyMotor', pouType: 'function-block', interface: { extends: 'MOTOR_VSD', variables: [] } },
    { name: 'I_Mine', pouType: 'interface', interface: { extends: 'I_MOTOR', variables: [] } },
  ] as unknown as PLCPou[]
  const index = buildOopTypeIndex(project, [library])

  it.each([
    ['MOTOR', 'I_MOTOR', true],
    ['MOTOR_VSD', 'I_MOTOR', true],
    ['MOTOR_VSD', 'I_STATUS', true],
    ['MyMotor', 'I_MOTOR', true],
    ['MyMotor', 'MOTOR', true],
    ['I_Mine', 'I_STATUS', true],
    ['I_STATUS', 'I_MOTOR', false],
    ['PLAIN', 'I_MOTOR', false],
    ['MOTOR', 'MOTOR_VSD', false],
  ])('%s where %s is expected: %s', (source, target, expected) => {
    expect(isOopAssignable(index, source, target)).toBe(expected)
  })

  it('knows an abstract block, and the library tree does not offer it', () => {
    expect(isAbstractBlock(index, 'base')).toBe(true)
    const offered = buildLibraryTree(library).children.map((node) => (node.kind === 'pou' ? node.pou.name : ''))
    expect(offered).not.toContain('BASE')
    expect(offered).toContain('MOTOR')
  })
})

describe('the library splitter', () => {
  it('finds an abstract block and an interface', () => {
    const st =
      'INTERFACE I_A\n  METHOD M : BOOL\n  END_METHOD\nEND_INTERFACE\n\n' +
      'FUNCTION_BLOCK ABSTRACT B IMPLEMENTS I_A\n  METHOD PUBLIC M : BOOL\n    M := TRUE;\n  END_METHOD\nEND_FUNCTION_BLOCK\n'
    const split = splitProgramSt(st, [
      { name: 'I_A', kind: 'INTERFACE', language: 'st' },
      { name: 'B', kind: 'FUNCTION_BLOCK', language: 'st' },
    ])
    expect([...(split?.files.keys() ?? [])].sort()).toEqual(['B.st', 'I_A.st'])
    expect(split?.files.get('I_A.st')).toMatch(/^INTERFACE I_A[\s\S]*END_INTERFACE/)
  })
})

describe('the linter and methods', () => {
  it('does not count assignments in separate methods as one variable driven twice', () => {
    const st =
      'FUNCTION_BLOCK ABSTRACT M\n  VAR_OUTPUT IsAuto : BOOL; END_VAR\n' +
      '  METHOD PUBLIC IsAuto : BOOL\n    IsAuto := TRUE;\n  END_METHOD\n' +
      '  METHOD PUBLIC Other : BOOL\n    IsAuto := FALSE;\n  END_METHOD\n' +
      '  IsAuto := TRUE;\nEND_FUNCTION_BLOCK\n'
    const findings = lintProgram({ st, pous: [], systemLibraries: [], globals: [] })
    expect(findings.filter((finding) => finding.rule === 'variable-driven-twice')).toEqual([])
  })
})
