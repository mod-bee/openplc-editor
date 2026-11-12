# Methods of a C/C++ function block

A C/C++ function block can offer IEC 61131-3 methods (3rd edition, 6.6.5.4). A program calls
them like the methods of any function block:

```
ok := sp.Record(DATA := DEV.pump, SETTINGS := 'sts.fault=now; tot.runHours=log,db=0.1');
```

The program sees only a standard IEC interface: `METHOD`, `VAR_INPUT`, `VAR_IN_OUT`,
`VAR_OUTPUT`, a result. The method's body is C++, the library's own business, in the same file
as the block's `setup()` and `loop()`.

A method call copies nothing into the instance and adds nothing to the debugger table. Its
arguments are the call's parameters, not pins. That is the difference from a separate block
instance per record.

## The file

A C/C++ block file has three parts, in this order:

1. The IEC header: `FUNCTION_BLOCK <name>` and its `VAR_*` sections (unchanged).
2. The method declarations: one `METHOD ... END_METHOD` per method, with no body.
3. The C++: `setup()`, `loop()` and one C++ function per method.

```
(* A recorder: one engine, many records *)
FUNCTION_BLOCK RECORDER
  VAR_INPUT
    ENABLE : BOOL := TRUE;
  END_VAR
  VAR_OUTPUT
    CALLS : DINT;
    LAST_SETTINGS : STRING;
  END_VAR
  VAR
    total : DINT;
  END_VAR

METHOD PUBLIC Record : BOOL
  VAR_INPUT
    DATA : ANY;          (* the record, any type: a structure, an array, a value *)
    SETTINGS : ANY;      (* a STRING variable or a literal *)
  END_VAR
  VAR_IN_OUT
    COUNTER : DINT;
  END_VAR
  VAR_OUTPUT
    SIZE : DINT;
  END_VAR
END_METHOD

METHOD PUBLIC Reset
END_METHOD

#include <cstring>

void setup() {
}

void loop() {
}

bool Record() {
  CALLS = CALLS + 1;
  COUNTER = COUNTER + 1;
  SIZE = DATA.DISIZE;
  total = total + DATA.DISIZE;
  if (SETTINGS.TYPECLASS == strucpp::TYPE_CLASS::TYPE_STRING) {
    LAST_SETTINGS = reinterpret_cast<const char *>(SETTINGS.PVALUE);
  }
  return ENABLE;
}

void Reset() {
  CALLS = 0;
}
END_FUNCTION_BLOCK
```

The editor keeps the declarations at the head of the POU's body, as it keeps an ST block's
methods. In the editor the C++ panel shows them above the C++.

## Declaring a method

- **`METHOD PUBLIC`.** A method without an access specifier is PROTECTED (IEC 61131-3 6.6.5.4)
  and cannot be called on an instance, so it is refused. `FINAL` is allowed. `ABSTRACT` and
  `OVERRIDE` are refused: a C/C++ block has no base and no derived block.
- **Parameters:** `VAR_INPUT`, `VAR_IN_OUT` and `VAR_OUTPUT`, any type the variables table
  takes, including `ANY` (and the other generics) and structures. `VAR`, `VAR_TEMP`,
  `VAR_INST` and the rest are refused: keep working values as locals of the C++ function.
- **Result:** `METHOD PUBLIC Name : <type>`, an elementary type, a `STRING`/`WSTRING` (with or
  without a length), an enumeration or a structure. Omit `: <type>` for a method that returns
  nothing. A generic (`ANY`), an array or a reference is refused.
- **No body.** Anything other than comments after the last `END_VAR` of a method is refused.
- **Names.** A parameter cannot have the name of a variable of the block (a pin, a `VAR`, a
  `VAR_EXTERNAL`): in the C++ both are reached by name. `vars` and `args` are taken by the
  generated C++. A method cannot be named `setup` or `loop`, or like a variable of the block.
  All comparisons ignore case, as IEC names do.

## Writing the C++ function

Each method is one C++ function with the method's name and no parameters:

```cpp
bool Record() { ... }      // METHOD PUBLIC Record : BOOL
void Reset() { ... }       // METHOD PUBLIC Reset
```

- Exactly one such function per method; the name matches the method's in any case.
- `void` exactly when the method declares no result. Otherwise the return type you write is
  replaced by the method's declared type (`strucpp::IEC_BOOL` for `BOOL`), so `return` any value
  that converts to it: `return true;`, `return CALLS > 0;`, `return "text";` for a `STRING`.
- The function is the method's entry point and is renamed by the build. Do not call it from
  your own C++; put shared code in a helper function and call that.

Inside the function these are reachable by name, exactly as pins are in `loop()`:

| Name | Is |
|---|---|
| a `VAR_INPUT` | a reference to the method's own copy of the argument (the IEC type's `strucpp::IEC_*` wrapper, e.g. `strucpp::IEC_STRING &`) |
| an `ANY` (or other generic) `VAR_INPUT` | a `strucpp::IEC_ANY &` describing the argument: `TYPECLASS`, `PVALUE` (its storage), `DISIZE`, `DICOUNT`, `DISTRIDE`, `ELEMCLASS`, `TYPEDESC` (a structure's member table), `NAME`, `TYPENAME`; `count()`, `wired()`, `at(i)`, `element<T>(i)`. `PVALUE` points at the caller's variable for the duration of the call |
| a `VAR_IN_OUT` / `VAR_OUTPUT` | a reference to the caller's variable: a write is seen by the caller |
| a one-dimensional `ARRAY` parameter | a pointer indexed by the declared IEC range, `LEVELS[1]` |
| the block's pins, `VAR`s and `VAR_EXTERNAL`s | the same as in `loop()` |

An `ANY` input may be given a literal or an expression (`SETTINGS := 'y=log'`,
`SETTINGS := k + 1`). It gets a temporary of the value's type for the duration of the call.
(The block's own `ANY` *pins* still take only a variable: an instance keeps a pin's descriptor
past the call.)

## When it runs

- In the calling task, at the call, like any method.
- If the block's `setup()` has not run yet, it runs first, once.
- Under the same locks as `loop()`: each `VAR_EXTERNAL` global is locked for the call, in name
  order.
- `loop()` runs only when the instance itself is called (`sp();` or `sp(ENABLE := TRUE)`). A
  block that does its work in `loop()` (a connection, a queue) still needs that call every scan.

## What the build generates

For reference only; nothing here is written by hand. For a block `RECORDER`:

- `c_blocks.h`: `RECORDER_RECORD_ARGS`, a struct of one pointer per parameter, and
  `extern "C" strucpp::IEC_BOOL recorder__record(RECORDER_VARS *vars, RECORDER_RECORD_ARGS *args);`
- `c_blocks_code.cpp`: `bool Record() {` becomes that function, with each parameter bound to
  its name on the same line (line numbers in compiler messages do not move).
- The block's ST: each `METHOD` with an `{external}` body that fills both structs, runs
  `setup()` if needed and calls the function, assigning the result.

## Libraries and tools

- **`.stlib`:** the manifest entry of a C/C++ block lists its PUBLIC methods, with their
  parameters and result, as an ST block's entry does. Blocks without methods produce the same
  manifest as before.
- **Library tree:** a block with methods has an arrow; it shows one row per method
  (`Record : BOOL`), with the call's signature on hover.
- **`openplc-cli apply`:** a C/C++ block's `body.text` is the body as the file holds it: the
  method declarations first, then the C++. `apply` checks the methods against the block's
  variables and the C++ and reports each problem by `"BLOCK.Method"`.
- **`openplc-cli describe`** shows the methods of a library block.
- **`check --lint`** and the editor's ST checking know the methods: a call to one resolves.

## Messages

Each problem is reported naming the block and the method, before anything is compiled:

| Message | Fix |
|---|---|
| `declare it METHOD PUBLIC` | add `PUBLIC` |
| `the parameter "X" has the name of a variable of the block` | rename the parameter |
| `has no C++ function` / `has 2 C++ functions` | define `<type> Name()` once |
| `returns INT, so its C++ function cannot be void` / `returns nothing, so its C++ function must be "void Name()"` | match the result |
| `declares VAR` | make it a local of the C++ function |
| `declares its interface only` | move the body into the C++ function |
| `cannot return a generic type` / `an array` / `a reference` | return a value type, or use a `VAR_OUTPUT` / `VAR_IN_OUT` |
| `only a function block has methods` | methods belong to a `FUNCTION_BLOCK` |
