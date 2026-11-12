import { generateCBlocksCode } from '../../../../backend/shared/utils/cpp/generateCBlocksCode'
import { generateCBlocksHeader } from '../../../../backend/shared/utils/cpp/generateCBlocksHeader'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { cppMethodErrors, cppMethodParameterBinding, findMethodDefinitions, splitCppMethods } from '../cpp-methods'
import { generateSTCode } from '../generateSTCode'

const pin = (name: string, cls: PLCVariable['class'], value: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
  debug: false,
})

const DECLARATIONS = `METHOD PUBLIC Record : BOOL
  VAR_INPUT
    DATA : ANY;
    NAME : STRING;
    LEVELS : ARRAY [1..4] OF INT;
  END_VAR
  VAR_IN_OUT
    COUNTER : DINT;
  END_VAR
  VAR_OUTPUT
    SIZE : DINT;
  END_VAR
END_METHOD
(* no parameters, no result *)
METHOD PUBLIC Reset
END_METHOD
`

const CPP = `#include <cstring>
void setup() { }
void loop() { }
// bool Record() { in a comment, not a definition }
bool Record() {
  return NAME == "x";
}
void
Reset()
{
  COUNT = 0;
}
`

const BLOCK_VARIABLES = [pin('ENABLE', 'input', 'BOOL'), pin('COUNT', 'output', 'DINT'), pin('total', 'local', 'DINT')]

const errorsOf = (body: string, variables: PLCVariable[] = BLOCK_VARIABLES, pouType = 'function-block') =>
  cppMethodErrors({ name: 'ENGINE', pouType, variables, body })

describe('splitCppMethods', () => {
  it('reads the declarations at the head of the body and leaves the C++', () => {
    const split = splitCppMethods(DECLARATIONS + CPP)
    expect(split.errors).toEqual([])
    expect(split.code).toBe(CPP)
    expect(split.methods.map((m) => [m.name, m.access, m.returnType])).toEqual([
      ['Record', 'PUBLIC', 'BOOL'],
      ['Reset', 'PUBLIC', undefined],
    ])
    expect(split.methods[0].variables.map((v) => [v.name, v.class, v.type.value])).toEqual([
      ['DATA', 'input', 'ANY'],
      ['NAME', 'input', 'STRING'],
      ['LEVELS', 'input', 'ARRAY [1..4] OF INT'],
      ['COUNTER', 'inOut', 'DINT'],
      ['SIZE', 'output', 'DINT'],
    ])
    expect(split.methods[1].declaration).toBe('METHOD PUBLIC Reset\n')
  })

  it('returns a body that declares no method unchanged', () => {
    const body = '// METHOD in a comment\nvoid setup() {}\nvoid loop() {}\nint METHOD = 1;\n'
    expect(splitCppMethods(body)).toEqual({ methods: [], code: body, errors: [] })
  })

  it('reads a declaration written on one line', () => {
    const split = splitCppMethods('METHOD PUBLIC Get : INT VAR_INPUT i : INT; END_VAR END_METHOD\nvoid setup(){}')
    expect(split.methods[0].returnType).toBe('INT')
    expect(split.methods[0].variables.map((v) => v.name)).toEqual(['i'])
    expect(split.code).toBe('void setup(){}')
  })

  it('reports a method with no END_METHOD', () => {
    expect(splitCppMethods('METHOD PUBLIC Get : INT\nvoid setup(){}').errors).toEqual([
      'A METHOD of this C/C++ block has no END_METHOD.',
    ])
  })
})

describe('findMethodDefinitions', () => {
  it('finds the definition outside comments, with its return type, any case', () => {
    const found = findMethodDefinitions(CPP, 'RECORD')
    expect(found).toHaveLength(1)
    expect(found[0].returnType).toBe('bool')
    expect(CPP.slice(found[0].start, found[0].end)).toBe('bool Record() {')
    expect(findMethodDefinitions(CPP, 'Reset')[0].returnType).toBe('void')
  })

  it('does not take a call or a declaration for a definition', () => {
    expect(
      findMethodDefinitions('void loop() { if (x) Record(); return Record(); }\nbool Record();', 'Record'),
    ).toEqual([])
  })

  it('skips a preprocessor line in front of the return type', () => {
    const code = '#include <x.h>\nstatic_assert(1, "");\n#define A 1\nint Get() { return 1; }'
    expect(findMethodDefinitions(code, 'Get')[0].returnType).toBe('int')
  })
})

describe('cppMethodErrors', () => {
  it('accepts a well-formed block, and a block with no methods', () => {
    expect(errorsOf(DECLARATIONS + CPP)).toEqual([])
    expect(errorsOf(CPP)).toEqual([])
  })

  it('refuses methods on anything but a function block', () => {
    expect(errorsOf(DECLARATIONS + CPP, BLOCK_VARIABLES, 'program')).toEqual([
      '"ENGINE": only a function block has methods (IEC 61131-3 6.6.5.4).',
    ])
  })

  it('refuses a parameter named like a block variable, or like the glue', () => {
    const body = 'METHOD PUBLIC Set\n  VAR_INPUT total : INT; vars : INT; END_VAR\nEND_METHOD\nvoid Set() {}\n'
    expect(errorsOf(body)).toEqual([
      '"ENGINE.Set": the parameter "total" has the name of a variable of the block. ' +
        'In the C++ both are reached by name, so give the parameter its own name.',
      '"ENGINE.Set": "vars" is used by the generated C++; name the parameter otherwise.',
    ])
  })

  it('refuses a method that is not PUBLIC, abstract, or named like the entry points', () => {
    const body =
      'METHOD Quiet\nEND_METHOD\nMETHOD PUBLIC ABSTRACT Later\nEND_METHOD\nMETHOD PUBLIC loop\nEND_METHOD\n' +
      'void Quiet() {}\nvoid Later() {}\nvoid loop() {}\n'
    const errors = errorsOf(body).join('\n')
    expect(errors).toMatch(/"ENGINE.Quiet": declare it METHOD PUBLIC/)
    expect(errors).toMatch(/"ENGINE.Later": ABSTRACT does not apply/)
    expect(errors).toMatch(/"ENGINE.loop": "loop" is the block's own entry point/)
  })

  it('refuses locals, a body in ST, and a generic or array result', () => {
    expect(errorsOf('METHOD PUBLIC A\n  VAR x : INT; END_VAR\nEND_METHOD\nvoid A() {}')).toEqual([
      '"ENGINE": Method "A" declares VAR. A C/C++ block\'s method takes VAR_INPUT, VAR_IN_OUT and VAR_OUTPUT only; ' +
        'keep working values as locals of its C++ function.',
    ])
    expect(errorsOf('METHOD PUBLIC B\n  VAR_INPUT x : INT; END_VAR\n  x := 1;\nEND_METHOD\nvoid B() {}')).toEqual([
      '"ENGINE": Method "B" of a C/C++ block declares its interface only. Write its body in C++, as the function "B()".',
    ])
    expect(errorsOf('METHOD PUBLIC C : ANY\nEND_METHOD\nMETHOD PUBLIC D : ARRAY [0..1] OF INT\nEND_METHOD\n')).toEqual(
      expect.arrayContaining([
        '"ENGINE.C": a method cannot return a generic type ("ANY").',
        '"ENGINE.D": a method cannot return an array ("ARRAY [0..1] OF INT").',
      ]),
    )
  })

  it('requires exactly one C++ function per method, void exactly when it returns nothing', () => {
    expect(errorsOf('METHOD PUBLIC Get : INT\nEND_METHOD\nvoid setup() {}')).toEqual([
      '"ENGINE.Get" has no C++ function. Define "<type> Get() { ... }" in the block\'s C++.',
    ])
    expect(errorsOf('METHOD PUBLIC Get : INT\nEND_METHOD\nint Get() { return 1; }\nint get() { return 2; }')).toEqual([
      '"ENGINE.Get" has 2 C++ functions "Get()"; define it once.',
    ])
    expect(errorsOf('METHOD PUBLIC Get : INT\nEND_METHOD\nvoid Get() {}')).toEqual([
      '"ENGINE.Get" returns INT, so its C++ function cannot be void.',
    ])
    expect(errorsOf('METHOD PUBLIC Go\nEND_METHOD\nint Go() { return 1; }')).toEqual([
      '"ENGINE.Go" returns nothing, so its C++ function must be "void Go()".',
    ])
  })
})

describe('cppMethodParameterBinding', () => {
  it('binds a value by reference and a one-dimensional array to its offset pointer', () => {
    expect(cppMethodParameterBinding(pin('Data', 'input', 'ANY'))).toBe('auto& Data = *args->DATA; (void)Data;')
    const array = splitCppMethods(DECLARATIONS).methods[0].variables[2]
    expect(cppMethodParameterBinding(array)).toBe('auto* const LEVELS = args->LEVELS; (void)LEVELS;')
  })
})

describe('the generated method glue', () => {
  it('writes each METHOD with an {external} body that calls its C++ function', () => {
    const st = generateSTCode({
      pouName: 'Engine',
      allVariables: [...BLOCK_VARIABLES, pin('G_MODE', 'external', 'INT')],
      body: DECLARATIONS + CPP,
    })
    // The declaration as written, then the glue, then END_METHOD.
    expect(st.indexOf('METHOD PUBLIC Record : BOOL')).toBe(0)
    expect(st).toContain(
      'ENGINE_VARS vars;\nvars.ENABLE = &ENABLE;\nvars.COUNT = &COUNT;\nvars.TOTAL = &TOTAL;\nENGINE_RECORD_ARGS args;\n' +
        'args.DATA = &DATA;\nargs.NAME = &NAME;\nargs.LEVELS = &LEVELS[1] - 1;\nargs.COUNTER = &COUNTER;\nargs.SIZE = &SIZE;\n}',
    )
    // setup() first if the block has not run, then the call under the global's lock.
    expect(st).toContain(
      'if hasBeenInitialized = False then\n{external\nG_MODE->with_lock([&](auto* g0) {\nvars.G_MODE = g0;\nengine_setup(&vars);\n});\n}',
    )
    expect(st).toContain(
      'G_MODE->with_lock([&](auto* g0) {\nvars.G_MODE = g0;\nRECORD_result = engine__record(&vars, &args);\n});\n}\nEND_METHOD\n',
    )
    expect(st).toContain('engine__reset(&vars, &args);\n});\n}\nEND_METHOD\n')
    // The block's own body follows the methods.
    expect(st.indexOf('engine_loop(&vars);')).toBeGreaterThan(st.lastIndexOf('END_METHOD'))
  })

  it('leaves a block without methods exactly as before', () => {
    const variables = [pin('speed', 'input', 'INT')]
    expect(generateSTCode({ pouName: 'B', allVariables: variables, body: CPP })).toBe(
      generateSTCode({ pouName: 'B', allVariables: variables }),
    )
  })

  it('declares each method’s args struct and entry point in c_blocks.h', () => {
    const header = generateCBlocksHeader([{ name: 'Engine', variables: BLOCK_VARIABLES, code: DECLARATIONS + CPP }])
    expect(header).toContain(
      'typedef struct {\n  strucpp::IEC_ANY *DATA;\n  strucpp::IEC_STRING *NAME;\n  strucpp::IEC_INT *LEVELS;\n' +
        '  strucpp::IEC_DINT *COUNTER;\n  strucpp::IEC_DINT *SIZE;\n} ENGINE_RECORD_ARGS;\n' +
        'extern "C" strucpp::IEC_BOOL engine__record(ENGINE_VARS *vars, ENGINE_RECORD_ARGS *args);\n',
    )
    expect(header).toContain(
      'typedef struct {\n} ENGINE_RESET_ARGS;\nextern "C" void engine__reset(ENGINE_VARS *vars, ENGINE_RESET_ARGS *args);\n',
    )
    expect(generateCBlocksHeader([{ name: 'B', variables: BLOCK_VARIABLES, code: CPP }])).toBe(
      generateCBlocksHeader([{ name: 'B', variables: BLOCK_VARIABLES }]),
    )
  })

  it('spells a user type result as a pin of that type is spelled', () => {
    const header = generateCBlocksHeader(
      [{ name: 'E', variables: [], code: 'METHOD PUBLIC Mode : RUN_MODE\nEND_METHOD\n' }],
      ['RUN_MODE'],
    )
    expect(header).toContain('extern "C" strucpp::IEC_RUN_MODE e__mode(E_VARS *vars, E_MODE_ARGS *args);')
  })

  it('turns each C++ function into its entry point, keeping line numbers', () => {
    const code = generateCBlocksCode([{ name: 'Engine', variables: BLOCK_VARIABLES, code: DECLARATIONS + CPP }])
    expect(code).not.toContain('METHOD PUBLIC')
    expect(code).toContain(
      'extern "C" decltype(engine__record(nullptr, nullptr)) engine__record(ENGINE_VARS *vars, ENGINE_RECORD_ARGS *args) {' +
        ' (void)vars; (void)args; auto& DATA = *args->DATA; (void)DATA; auto& NAME = *args->NAME; (void)NAME;' +
        ' auto* const LEVELS = args->LEVELS; (void)LEVELS; auto& COUNTER = *args->COUNTER; (void)COUNTER;' +
        ' auto& SIZE = *args->SIZE; (void)SIZE;\n  return NAME == "x";',
    )
    expect(code).toContain(
      'extern "C" decltype(engine__reset(nullptr, nullptr)) engine__reset(ENGINE_VARS *vars, ENGINE_RESET_ARGS *args) {' +
        ' (void)vars; (void)args;\n\n\n  COUNT = 0;',
    )
    // The commented-out definition is left alone.
    expect(code).toContain('// bool Record() { in a comment, not a definition }')
    expect(code.split('\n').length).toBe(
      generateCBlocksCode([{ name: 'Engine', variables: BLOCK_VARIABLES, code: CPP }]).split('\n').length,
    )
  })
})
