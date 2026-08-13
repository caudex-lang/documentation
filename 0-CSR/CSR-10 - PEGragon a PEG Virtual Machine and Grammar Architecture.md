## Caudex Standard Recommendation 10 (CSR-10)

## PEGragon a PEG Virtual Machine and Grammar Architecture

| Field         | Value                             |
|:--------------|:----------------------------------|
| **Version**   | 1.0.0                             |
| **Author(s)** | Madeleine                         |
| **Date**      | 13 August 2026                    |
| **Status**    | Draft                             |

### 1. Introduction
 
**PEGragon** is a bytecode interpreter for Parsing Expression Grammars.
Grammars are compiled to a static bytecode array that the VM interprets
directly — no generated parser code is shipped. This approach ensures
that the grammar is defined in exactly one place and that every
implementation of the parser runs the same parsing logic.

This document defines:

*   The **PEGragon dialect** of PEG notation, including AST capture markers,
    cut operators, function calls, and macros.
*   The **PEGragon opcode set**, instruction encoding, and execution model.

### 2. Why a PEG VM?

Traditional parsers use parser generators (Yacc, Bison, ANTLR) that emit
source code in a target language. This has drawbacks:

*   **Generated code divergence.** The generated parser in one language and a
    hand-ported version in another are different programs. Bugs and drift are
    inevitable.
*   **Generator lock-in.** Changing the generator requires a full rewrite of
    the grammar and all build infrastructure.
*   **Portability cost.** Porting the parser to a new host language means
    porting or re-generating the parser for that language.
*   **Reuse of the grammar.** Other than being portable between language, the
    use of a VM allow to reuse the same grammar for different purpose with only
    changing the code handling the AST. This is what allow Caudex to use the
    same grammar for both compiling and executing some part of the code during 
    compilation.

With a PEG VM, the grammar is compiled to a **platform-independent bytecode
array**. Every implementation includes a small VM interpreter (~200 lines,
~20 opcodes). The bytecode is identical across all hosts — only the
interpreter loop is reimplemented.

PEGs themselves were chosen over BNF/LALR because:

*   **Unambiguous by construction.** Ordered choice (`/`) replaces unordered
    `|`, eliminating shift/reduce conflicts.
*   **Scannerless.** No separate lexer pass. Whitespace and comments are
    handled by grammar rules.
*   **Left-recursion eliminated naturally.** Expression grammars are rewritten
    as iterative `(op expr)*` patterns.

### 3. PEG Grammar Notation (PEGragon Dialect)

PEGragon extends standard PEG notation with AST capture markers, cut
operators, built-in function calls, and macros.

#### 3.1. Core PEG Constructs

| Construct       | Syntax            | Description                                            |
|:----------------|:------------------|:-------------------------------------------------------|
| Sequence        | `A B`             | Match A then B.                                        |
| Ordered Choice  | `A / B`           | Try A; if it fails, try B.                             |
| Zero-or-more    | `A*`              | Match A zero or more times.                            |
| One-or-more     | `A+`              | Match A one or more times.                             |
| Optional        | `A?`              | Match A zero or one time.                              |
| And-predicate   | `&A`              | Try A without consuming input (succeeds if A matches). |
| Not-predicate   | `!A`              | Try A without consuming input (succeeds if A fails).   |
| Literal string  | `'text'` / `"text"` | Match exact sequence of bytes.                       |
| Character class | `[a-z]`           | Match one byte in the set or range.                    |
| Any character   | `.`               | Match any single byte (fails at EOF).                  |
| Rule reference  | `RuleName`        | Match the named rule.                                  |
| Grouping        | `(A)`             | Group sub-expressions.                                 |

#### 3.2. AST Capture Markers (`~Rule`)

The `~` annotation on a rule definition marks that rule for AST node
construction. When the rule succeeds, the VM creates an AST node tagged
with the rule name:

```
~Rule <- Pattern
```

A rule defined without `~` matches input but produces no AST node of its
own — it still participates in matching and may be referenced by other
rules. This lets you write "helper" rules that parse structure without
cluttering the AST.

The annotation compiles to capture instructions that wrap the rule body:

```
CAP NODE(tag=Rule) [Pattern] CAP_END POP
```

*   `I_CAP` saves the current input position as the start of the node.
*   `I_NODE` pushes a new `AstNode(tag)` onto the node stack.
*   `I_CAP_END` sets the node's source range `(start, end)` from the
    saved position to the current input position.
*   `I_POP` pops the completed node; if a parent node exists on the
    stack, the popped node becomes its child.

For example:

```
~AdditiveExpression <- MultiplicativeExpression ( ('+' / '-') MultiplicativeExpression)*
```

produces a single `AdditiveExpression` node whose source range spans the
entire matched text. Rules referenced inside it (like
`MultiplicativeExpression`) may or may not produce their own nodes
depending on whether they are also marked with `~`.

#### 3.3. Cut Operator (`^`)

The cut operator commits the parser to the current alternative, discarding
inner backtrack points so that subsequent failure does not waste time
re-trying other branches within the same choice level.

Syntax:

```
Cut <- '^' Identifier?   # Identifier is optional
```

When the VM reaches a cut, it removes all backtrack entries that were
pushed after the most recent enclosing `I_CHOICE`. Any failure after the
cut propagates immediately to the next outer choice level — the inner
alternatives are no longer candidates.

Examples:

```
WhileStmt <- "while" !WordChar Spaces* ^ "(" Expr ")" Stmt
```

Once `while` and the mandatory separator match, the cut prevents
backtracking into other top-level alternatives if `(`, `Expr`, or `)` fail.
The parser is committed to a `WhileStmt`.

```
IfStmt <- "if" !WordChar Spaces* ^IfSyntaxError "(" Expr ")" Stmt
```

The optional identifier (e.g. `IfSyntaxError`) provides an **error tag**
that is passed to the host program when a failure occurs after the cut.
This enables rich, context-aware error messages.

On failure after a cut, the VM produces diagnostic data:

```c
struct peg_diagnostic_data 
{
    const char* error_tag;      // e.g. "IfSyntaxError" (from the ^ tag)
    const char* failed_rule;    // e.g. "IfStmt"
    const char* expected_token; // e.g. ")" (from the failed VM instruction)
    uint32_t    error_offset;   // byte offset of the error
    uint32_t    line;           // line number (1-based)
    uint32_t    column;         // column number (1-based)
};
```

If no identifier is given after `^`, `error_tag` defaults to
`failed_rule`.

The cut is **local** — it only affects the nearest enclosing choice level.
In:

```
(A ^ B / C) / D
```

The cut before `/ C` discards only the `B` and `C` alternatives within
the inner group. The outer alternative `D` remains available.

**Opcode:** `I_CUT` — Discard backtrack entries above the current choice
frame and commit to the active alternative.

#### 3.4. Decorators (`@`)

The `@` syntax is a **rule decorator**, placed on its own line immediately
before a rule definition (Python-style). It annotates the rule with
metadata that the VM will use.

Currently supported decorators:

| Decorator            | Description                                        |
|:---------------------|:---------------------------------------------------|
| `@sync(tok, ...)`    | Register sync tokens for the decorated rule.       |

`@sync` takes one or more arguments (character literals or string
literals) that become recovery tokens. When parsing fails inside the
decorated rule (or any rule it calls), the VM can use these tokens to
resynchronise: it scans forward in the input for one of the tokens,
resets the parser state, and retries from the parent rule.

If multiple rules on the call stack have `@sync` decorators, they are all 
active, but they are ordered as in a FILO stack. If the same token appears
in multiple rules, the innermost rule's version takes priority.

Example:

```
lines <- line*

@sync(';')
~line <- text ';'

text <- [^;]
```

Here `@sync(';')` decorates `~line`. When a parse error occurs inside
`line`, the VM skips forward to the next `;` and retries `lines` from
that point. This effectively skips the malformed line and continues with
the next one.

#### 3.5. Macros (`$`)

Macros are parameterized pattern templates expanded at compile time.

Definition syntax:

```
$Name(params) <- Elements
```

Call syntax (same as function calls, but expanded inline):

```
$Name(args, ...)
```

Example:

```
$List(Element, Sep) <- Element (Sep Element)* Sep?

Params     <- "(" $List(ParamDecl, ",") ")"
ArrayElems <- "[" $List(Expr, ",") "]"
```

The macro `$List` is parameterized by `Element` and `Sep`. At each call
site, `pegrc` substitutes the template and binds the arguments to the
parameters. Macros can be nested and may reference other macros.

### 4. PEGragon Opcode Reference

Each instruction is a 32-bit word: `[opcode:8][arg:24]`. The `arg` is
sign-extended for branch offsets (`I_CALL`, `I_JUMP`, `I_CHOICE`,
`I_COMMIT`, `I_PARTIAL`) and treated as unsigned for indices (`I_LIT`,
`I_SET`, `I_SPAN`, `I_NODE`).

#### 4.1. Matching Opcodes

| Opcode    | Arg              | Description                                                |
|:----------|:-----------------|:-----------------------------------------------------------|
| `I_CHAR`  | byte value       | Match a single byte at current position.                   |
| `I_ANY`   | —                | Match any single byte (fails at EOF).                      |
| `I_RANGE` | `lo<<12 \| hi`   | Match byte in `[lo, hi]` inclusive.                        |
| `I_SET`   | bitmap index     | Match byte if set in a 256-bit bitmap.                     |
| `I_LIT`   | string-table idx | Match literal null-terminated string.                      |
| `I_SPAN`  | bitmap index     | Consume bytes while they match the bitmap (zero-or-more).  |

#### 4.2. Control Flow Opcodes

| Opcode      | Arg           | Description                                              |
|:------------|:--------------|:---------------------------------------------------------|
| `I_JUMP`    | signed offset | Unconditional branch: `ip += sarg + 1`                   |
| `I_CALL`    | signed offset | Push return address, branch: push `ip`, `ip += sarg + 1` |
| `I_RET`     | —             | Return from call; if `call_sp == 0`, set `matched=1`     |
| `I_CHOICE`  | signed offset | Save backtrack state: push `pos, ip+sarg+1, ...`         |
| `I_COMMIT`  | signed offset | Pop backtrack entry, branch: `bt_sp--; ip += sarg + 1`   |
| `I_PARTIAL` | signed offset | Update active backtrack entry's `pos`, `node_sp`, and `cap_pos` |
| `I_FAIL`    | —             | Force backtrack: jump to fail handler                     |
| `I_CUT`     | —             | Commit: discard all backtrack entries above the current choice frame |
| `I_TRUE`    | —             | No-op, always succeeds                                    |
| `I_END`     | —             | Successful parse: set `matched=1`, return                 |

**I_CUT details:** On execution, the backtrack stack pointer is adjusted
so that entries belonging to inner alternatives (pushed after the most
recent `I_CHOICE`) are removed. The current alternative is committed.

#### 4.3. AST Construction Opcodes

| Opcode     | Arg | Description                                                 |
|:-----------|:----|:------------------------------------------------------------|
| `I_CAP`    | —   | Save `cap_pos` on cap stack; set `cap_pos = pos`.           |
| `I_NODE`   | tag | Create new `AstNode(tag)`, push onto node stack.            |
| `I_CAP_END`| —   | Set top node's source range `(soff, seoff)`, restore cap_pos.|
| `I_POP`    | —   | Pop top node; if stack non-empty, add as child of new top.  |

#### 4.4. Special Opcodes

*(None currently assigned.)*

#### 4.5. Backtrack Mechanics

On failure (`I_FAIL` or any matching instruction failing):
1.  If `bt_sp == 0` (the stack is empty), set matched=0 and exit (definitive failure).
2.  Otherwise, decrement backtrack stack pointer (`bt_sp--`).
3.  Free AST nodes from `node_sp` down to the saved node stack pointer in the backtrack entry.
4.  Restore `pos`, `ip`, `node_sp`, `call_sp`, `cap_sp`, `cap_pos` from the backtrack entry 
    and resume execution at the restored `ip`.

When a cut has been executed, the backtrack entries between the most
recent `I_CHOICE` and the cut are absent — the failure propagates
directly to the next outer choice or to the rule level.

#### 4.6. Instruction Encoding

```c
#define I_ENCODE(op, arg) \
    (((uint32_t)(op) << 24) | ((uint32_t)(arg) & 0x00FFFFFFu))
```

#### 4.7. Bytecode File Format (`.pegrc`)

```
Header:
 uint32 magic
 uint32 code_len
 uint32 num_bitmaps
 uint32 num_strings
 uint32 num_rules
 uint32 num_sync

Code:
  array of size uint32_t * code_len

Bitmaps:
  array of size sizeof(peg_bitmap) * num_bitmaps

String:
  array of size (null terminated string + padding to 4-bytes) * num_strings

Rules:
  array of size sizeof(rule_entry) * num_rules

Sync:
  array of size sizeof(sync_entry) * num_sync
```

*   **Magic:** `0x00524750` LE, `0x50475200` BE (ASCII `PGR\0`, stored in
    big endian on disk).
*   **String/bitmap deduplication:** `pegrc` deduplicates string literals and
    bitmaps at compile time via linear scan, keeping the `.pegrc` binary
    compact.
*   **PEG Bitmap:** is a simple 256 bits bitmap representing all 256 possible 8bit ASCII
    characters.
*   **Rule entries:** each `rule_entry` is `{ uint32 start_addr, uint32 tag, uint32 name_idx }` 
    mapping a bytecode position to an AST node tag, and linking it to its string 
    name. Entries are sorted by `start_addr`. The end of a rule's range is the 
    next entry's `start_addr` (or `code_len` for the last rule). Used by the 
    recovery logic to map call-stack return addresses back to rule tags.
*   **Sync entries:** each `sync_entry` is `{ uint32 rule_tag, uint32 token }` where
    `token` follows the same encoding:

    ```
    bit 23 = 0 -> bits 22–0 are a bitmap-table index
    bit 23 = 1 -> bits 22–0 are a string-table index
    ```

    `num_sync` may be 0 if no rule carries an `@sync` decorator.

#### 4.8. VM Stack Capacities

All internal stacks start at 256 entries and grow by 2* on overflow (via
`realloc`):

| Stack           | Entry Type      | Description                                            |
|:----------------|:----------------|:-------------------------------------------------------|
| Backtrack (bt)  | struct (6 flds) | `pos`, `ip`, `node_sp`, `call_sp`, `cap_sp`, `cap_pos` |
| Call            | `uint32_t`      | Return address IP                                      |
| Node            | `AstNode*`      | AST node pointer                                       |
| Cap             | `size_t`        | Capture position                                       |

In the real world it is probably a good idea to limit how big each stack can grow.
The limit to set is left to the implementation of the VM.

### 5. Cut Semantics and Error Recovery

The cut operator (`^`) and the `@sync` decorator work together to provide
robust error reporting and recovery.

When a cut is followed by a match failure:

1. The VM unwinds the backtrack stack to the most recent enclosing choice
   that lies above the cut point.
2. Diagnostic information is extracted: the failed rule name, the expected
   token (from the failed instruction's operand), and the input position
   (byte offset, line, column).
3. The error tag is taken from the cut's optional identifier, or defaults
   to the failed rule name.
4. If the backtrack stack reaches zero, the VM enters recovery mode: it
   walks the call stack from innermost outward collecting sync tokens
   from `@sync` decorated rules (inner rules win conflicts), scans
   forward in the input for any collected token, resets all VM stacks,
   and retries parsing from the grammar start (see §B.7).

This allows the parser to report multiple errors in a single pass and to
provide specific, context-rich diagnostic messages (e.g. "In IfStmt,
expected ')' at line 5, column 12").

### 6. Toolchain Components

The PEG VM toolchain consists of several executables:

| Tool         | Purpose                                                   |
| :----------- | :-------------------------------------------------------- |
| `pegrc`      | Compiles `.pegr` files to `.pegrc` bytecode.              |
| `pegr-asm`   | Assemble a `.pegr.asm` assembly into a `.pegrc` bytecode  |
| `pegr-bench` | A benchmark tool to test the virtual machine performances |
| `pegr-dump`  | Disassembles `.pegrc` bytecode to human-readable format.  |
| `pegr-run`   | Runs a `.pegrc` grammar against input text, prints AST.   |
| `pegr-unt`   | Unit test for PEGragon                                    |


### Appendix A: PEGragon Meta-Grammar

The following PEG describes the full PEGragon syntax, including AST
capture markers, cut operators, function calls, and macros. This is the
grammar used by `pegrc` to parse `.pegr` grammar files.

It extends the canonical PEG meta-grammar (Ford 2004) with five
PEGragon-specific additions: `Capture` on rule definitions, `CUT` as a
prefix operator, `@` function calls and `$` macro calls as primaries, and
`$` macro definitions as a top-level definition form.

```pegragon
~Grammar       <- Spacing Definition+ EndOfFile
~Definition    <- Decorator* RuleHeader LEFTARROW Expression
~Decorator     <- AT_SIGIL Identifier OPEN ArgumentList? CLOSE
~RuleHeader    <- MacroDef / NodeGenDef / StandardDef
~MacroDef      <- DOLLAR_SIGIL Identifier OPEN ParameterList? CLOSE
~NodeGenDef    <- TILDE_SIGIL Identifier
~StandardDef   <- Identifier
~ParameterList <- Identifier (COMMA Identifier)*

~Expression    <- Sequence (SLASH Sequence)*

~Sequence      <- Step*
~Step          <- Prefix / Cut
~Prefix        <- (AND / NOT)? Suffix
~Suffix        <- Primary (QUESTION / STAR / PLUS)?
~Primary       <- Identifier !LEFTARROW
                / MacroCall
                / OPEN Expression CLOSE
                / Literal / Class / DOT

~MacroCall     <- DOLLAR_SIGIL Identifier OPEN ArgumentList? CLOSE
~ArgumentList  <- Expression (COMMA Expression)*
~Cut           <- POWER_SIGIL Identifier? Spacing

# Lexical syntax
~Identifier    <- IdentStart IdentCont* Spacing
IdentStart     <- [a-zA-Z_]
IdentCont      <- IdentStart / [0-9]
~Literal       <- ['] (!['] Char)* ['] Spacing
                / ["] (!["] Char)* ["] Spacing
~Class         <- '[' (!']' Range)* ']' Spacing
~Range         <- Char '-' Char / Char
~Char          <- '\\' [nrt'"\[\]\\]
                / '\\' [0-2][0-7][0-7]
                / '\\' [0-7][0-7]?
                / !'\\' .

LEFTARROW      <- '<-' Spacing
SLASH          <- '/' Spacing
~AND           <- '&' Spacing
~NOT           <- '!' Spacing
~QUESTION      <- '?' Spacing
~STAR          <- '*' Spacing
~PLUS          <- '+' Spacing
OPEN           <- '(' Spacing
CLOSE          <- ')' Spacing
~DOT           <- '.' Spacing

# PEGragon Lexical Tokens & Sigils (tag as SIGIL as they do not expect space after them)
COMMA          <- ',' Spacing

TILDE_SIGIL    <- '~'
DOLLAR_SIGIL   <- '$'
AT_SIGIL       <- '@'
POWER_SIGIL    <- '^'


Spacing        <- (Space / Comment)*
Comment        <- '#' (!EndOfLine .)* EndOfLine
Space          <- ' ' / '\t' / EndOfLine
EndOfLine      <- '\r\n' / '\n' / '\r'
EndOfFile      <- !.
```

### Appendix B: Assembly Format (`.pegr.asm` / `.pegrc`)

#### B.1. Overview

The assembly format (`.pegr.asm`) is a human-readable representation of PEGragon
bytecode. The assembler (`pegr-asm`) compiles it into a binary `.pegrc` file
(identical in format to the output of `pegrc`). This allows hand-writing or
debugging bytecode without going through the PEG compiler.

Assembly files use line-based directives, labels, and instructions:

```
; comment
.string "text"                              ; add string to table
.bitmap h1,h2,h3,h4,h5,h6,h7,h8            ; add bitmap (8 hex uint32)
label:                                      ; define label
  INSTRUCTION  operand                      ; emit instruction
```

The assembler resolves label references into signed branch offsets and
converts `.string` / `.bitmap` declarations into the corresponding bytecode
table entries.

#### B.2. Directives

**`.string`** — add a string to the string table and return its index.
```
.string "hello"
```
Strings are null-terminated and padded to 4-byte alignment in the binary.
Indexing is zero-based in declaration order.

**`.bitmap`** — add a 256-bit bitmap to the bitmap table and return its
index.
```
.bitmap h1, h2, h3, h4, h5, h6, h7, h8    ; 8 hex uint32, little-endian bits
```
Each `hN` is an 8-digit hexadecimal `uint32_t`. Bit 0 of the bitmap
corresponds to byte value 0, bit 255 to byte value 255. Bit `b` falls in
`hN` where `N = b / 32`, at position `b % 32`.

Example — bitmap matching `;` (59) and `\n` (10):
```
.bitmap 0x00000400,0x08000000,0,0,0,0,0,0
```

#### B.3. Labels

A label is an identifier followed by a colon (`:`), placed on its own line.
It marks the current bytecode position so that branch instructions can refer
to it. Labels are not emitted as instructions; they are resolved to offsets
at assembly time.

```
try_literal:
  LIT "keyword"
  END
```

Branch instructions (`JUMP`, `CALL`, `CHOICE`, `COMMIT`, `PARTIAL`) accept a
label operand. The assembler computes the signed 24-bit offset from the
instruction to the label.

Note: In the unlikely event a PEG file would generate too many entry, either 
nodes, rules, that would not fit in the 24 bit space, this would not be a VM 
issue as the compiler would simply refuse to compile the PEG file.

#### B.4. Instruction Reference

Each instruction is a 32-bit word: `[opcode:8][arg:24]`. The `arg` is
sign-extended for branch offsets (`I_CALL`, `I_JUMP`, `I_CHOICE`,
`I_COMMIT`, `I_PARTIAL`) and treated as unsigned otherwise. Below,
"encoding" shows the `I_ENCODE` arguments.

---

##### Matching Instructions

**`CHAR`** `'c'` / `0xNN` / `NNN`
```
Encoding:  I_ENCODE(I_CHAR, byte)
Arg:       byte value (0–255)
```
Match a single byte at the current input position. On match, advance by 1
and succeed. On mismatch, fail.

**`ANY`**
```
Encoding:  I_ENCODE(I_ANY, 0)
Arg:       unused
```
Match any single byte. Fails at end of input.

**`RANGE`** `lo hi`
```
Encoding:  I_ENCODE(I_RANGE, (lo << 12) | hi)
Arg:       lo in bits 23–12, hi in bits 11–0
```
Match the current byte if `lo ≤ byte ≤ hi`. On match, advance by 1 and
succeed.

**`SET`** `bm[N]` / `SET N`
```
Encoding:  I_ENCODE(I_SET, N)
Arg:       bitmap-table index N
```
Match the current byte if its bit is set in bitmap `N`. On match, advance
by 1 and succeed.

**`LIT`** `N` / `"str"`
```
Encoding:  I_ENCODE(I_LIT, N)
Arg:       string-table index N
```
Match the null-terminated string at string-table index `N` against the
current input position. On match, advance by the string length and succeed.
On mismatch, fail. The `"str"` form adds the string to the table and uses
its index.

**`SPAN`** `bm[N]` / `SPAN N`
```
Encoding:  I_ENCODE(I_SPAN, N)
Arg:       bitmap-table index N
```
Consume input bytes while each matches bitmap `N`. Always succeeds (may
consume zero bytes). Does not fail.
---

##### Control Flow Instructions

**`JUMP`** `label`
```
Encoding:  I_ENCODE(I_JUMP, offset)
Arg:       signed 24-bit offset (ip += sarg + 1)
```
Unconditional branch. Set `ip += arg + 1` (the +1 accounts for the
instruction's own width).

**`CALL`** `label`
```
Encoding:  I_ENCODE(I_CALL, offset)
Arg:       signed 24-bit offset
```
Call a subroutine. Push the return address (current `ip + 1`) onto the call
stack, then branch: `ip += arg + 1`.

**`RET`**
```
Encoding:  I_ENCODE(I_RET, 0)
Arg:       unused
```
Return from subroutine. Pop the call stack. If the call stack is now empty,
set `matched = 1` and signal successful parse. Otherwise, set `ip` to the
popped return address.

**`CHOICE`** `label`
```
Encoding:  I_ENCODE(I_CHOICE, offset)
Arg:       signed 24-bit offset
```
Save a backtrack frame. Push the current `pos`, `ip + arg + 1`, `node_sp`,
`call_sp`, `cap_sp`, and `cap_pos` onto the backtrack stack. The saved
`ip` is the failure continuation — on backtrack, execution resumes there.

**`COMMIT`** `label`
```
Encoding:  I_ENCODE(I_COMMIT, offset)
Arg:       signed 24-bit offset
```
Pop the top backtrack frame (`bt_sp--`) without restoring state, then
branch: `ip += arg + 1`. Used after a successful choice branch to discard
the saved alternative and jump past it.

**`PARTIAL`** `label`
```
Encoding:  I_ENCODE(I_PARTIAL, offset)
Arg:       signed 24-bit offset
```
Update the top backtrack frame's `pos`, `node_sp`, and `cap_pos` to the current
values, leaving the continuation `ip` unchanged. Then branch: `ip += arg + 1`.
Used in iterative loops (e.g. `(A)*`) to commit the consumed input and generated
AST nodes of the current iteration, so that when the loop eventually fails, it
gracefully exits out rather than rewinding all previous iterations.

**`FAIL`**
```
Encoding:  I_ENCODE(I_FAIL, 0)
Arg:       unused
```
Force a backtrack. If `bt_sp == 0`, set `matched = 0` and exit (definitive 
failure). Otherwise, decrement `bt_sp`. Free AST nodes from `node_sp` down
to the saved node stack pointer. Restore `pos`, `ip`, `node_sp`, `call_sp`,
`cap_sp`, `cap_pos` from the backtrack entry. (See also §5 for cut-interaction
behavior.)

**`TRUE`**
```
Encoding:  I_ENCODE(I_TRUE, 0)
Arg:       unused
```
No-op. Always succeeds, advances nothing.

**`END`**
```
Encoding:  I_ENCODE(I_END, 0)
Arg:       unused
```
Successful parse termination. Set `matched = 1` and return. Placed at the
end of each rule body.

---

##### AST Construction Instructions

**`NODE`** `tag=N` / `NODE N`
```
Encoding:  I_ENCODE(I_NODE, N)
Arg:       user-defined tag value (≥ 256)
```
Create a new `AstNode` with numeric tag `N` and push it onto the node stack.

**`POP`**
```
Encoding:  I_ENCODE(I_POP, 0)
Arg:       unused
```
Pop the top node from the node stack. If the stack is non-empty, add the
popped node as a child of the new top node.

**`CAP`**
```
Encoding:  I_ENCODE(I_CAP, 0)
Arg:       unused
```
Push the current `cap_pos` onto the cap stack, then set `cap_pos = pos`.
Marks the start of a node's source range.

**`CAP_END`**
```
Encoding:  I_ENCODE(I_CAP_END, 0)
Arg:       unused
```
Set the top node's source range `(cap_pos, pos)`, then restore `cap_pos`
by popping the cap stack.

---

##### Special Instructions

**`CUT`** `tag=N` / `"str"` (optional)
```
Encoding:  I_ENCODE(I_CUT, N)
Arg:       0 (no tag) or string-table index N (with tag)
```
Cut point — commit the parser to the current alternative. See §B.6 for
full specification.

#### B.5. PEGR-to-Assembly Examples

##### Example 1: Literal match

PEG: 
```
"hello"
```

Assembly:
```asm
  LIT "hello"
  END
```

##### Example 2: Sequence and ordered choice

PEG: 
```
"if" "(" Expr ")" Stmt / "while" "(" Expr ")" Stmt
```

Assembly:
```asm
  CHOICE _try_while
  LIT "if"
  LIT "("
  CALL Expr
  LIT ")"
  CALL Stmt
  COMMIT _end
_try_while:
  LIT "while"
  LIT "("
  CALL Expr
  LIT ")"
  CALL Stmt
_end:
  END
```

##### Example 3: Repetition (`*`)

PEG: 
```
('a' / 'b')*
```

Assembly:
```asm
  CHOICE _done        ; Push backtrack target (loop exit)
_loop:
  CHOICE _try_b       ; Push inner choice for 'a' / 'b'
  CHAR 'a'
  COMMIT _next        ; Matched 'a', discard _try_b and jump to commit
_try_b:
  CHAR 'b'            ; Inner choice fallback
_next:
  PARTIAL _loop       ; Commit cursor/AST for this iteration, jump back to _loop
_done:
  TRUE
```

`PARTIAL` commits the progress made during the iteration by updating the
`pos` in the outer `_done` backtrack frame. When an iteration finally fails,
execution correctly falls through to `_done` without losing the text matched
by previous iterations.

##### Example 4: AST capture

PEG: 
```
~Number <- [0-9]+
```

Assembly:
```asm
Number:
  CAP
  NODE tag=256        ; 256 = Number
  .string "number"
  .bitmap 0x03FF0000,0,0,0,0,0,0,0    ; bits 48-57 = '0'-'9'
  SPAN bm[0]          ; consume while digit (zero-or-more)
  ...                  ; one-or-more via choice
  CAP_END
  POP
  END
```

(Full one-or-more assembly omitted for brevity — combines `CHOICE`/`COMMIT`
with `PARTIAL` as in Example 3.)

##### Example 5: Cut operator

PEG: 
```
^ "(" Expr ")"
```

Assembly:
```asm
  CUT
  LIT "("
  CALL Expr
  LIT ")"
```

The `CUT` discards any backtrack entries pushed before it, so if `Expr`
fails, the VM does not try alternatives above the cut — it reports the
error directly.

##### Example 6: Cut with error tag

PEG: 
```
^IfSyntaxError "(" Expr ")"
```

Assembly:
```asm
  .string "IfSyntaxError"
  CUT tag=0           ; string-table index 0 -> "IfSyntaxError"
  LIT "("
  CALL Expr
  LIT ")"
```

#### B.6. CUT Specification (for Implementation)

The following section defines the exact runtime behaviour of `CUT`. It is
not yet implemented — this specification serves as the implementation
guide.

---

##### B.6.1. `I_CUT` — Cutting Point

**Encoding:**

| `arg` value | Meaning |
|-------------|---------|
| `0` | Cut without error tag. On failure, `error_tag` defaults to the containing rule name. |
| `> 0` | Cut with error tag. `error_tag = string_table[arg]`. |
| `≤ 0` | Reserved / invalid. |

**Execution (`I_CUT` reach in normal flow):**

1. Let `cut_choice_depth` be the backtrack-stack index of the most recent
   `I_CHOICE` entry. (If no choice is active, `cut_choice_depth` is the
   current `bt_sp`.)
2. Discard all backtrack entries with index `> cut_choice_depth`. Set
   `bt_sp = cut_choice_depth`.
3. Store the optional `error_tag` index (`arg`) in a VM-local "cut tag"
   field, associated with the current rule invocation.
4. Advance to the next instruction (`ip++`). **I_CUT itself never fails.**

**Behavior on subsequent failure (in the fail handler):**

When any instruction fails after `I_CUT` has been executed:

1. **Normal backtrack proceeds:** `bt_sp--`, restore state from the
   backtrack entry.
   - Because `I_CUT` removed inner entries, the restored state is the
     next outer choice (or the rule entry point if no outer choice
     exists).
2. **Diagnostic data is populated** from the failed instruction:
   - `error_tag`: the cut's tag if one was stored, otherwise the name of
     the rule that contains the cut.
   - `failed_rule`: the name of the rule containing the cut (from the
     nearest `~Rule` definition or the call-stack rule name).
   - `expected_token`: a human-readable representation of what the failed
     instruction expected:
     - `I_CHAR`: single-character string with the byte value.
     - `I_LIT`: the literal string from the string table.
     - `I_RANGE`: `"[lo–hi]"`.
     - `I_SET` / `I_SPAN`: `"<bitmap N>"`.
     - `I_ANY`: `"<any>"`.
   - `error_offset`, `line`, `column`: from the current `pos` at time of
     failure.
3. The diagnostic is delivered to the host program via a callback or return
   struct, allowing it to format and report the error.

**If `bt_sp == 0` after the cut (no outer choice):** The failure propagates
to the rule level exactly as described in §4.5, but with diagnostic data
attached. If the grammar has sync entries (see §B.7), recovery is attempted
before final failure.

**Multiple cuts:** Only the most recent `I_CUT`'s tag is used for
diagnostics. Earlier cuts within the same alternative are superseded.

---

#### B.7. Sync Token Specification

Sync tokens are stored as a **metadata table** in the `.pegrc` bytecode
(see §4.7). There are no sync-related VM instructions — the table is
loaded at grammar load time and consulted during error recovery.

##### B.7.1. Data tables

The `.pegrc` file embeds two tables that the recovery logic uses:

**`rules[]`** — `{start_addr, tag}` entries, sorted by `start_addr`.
Each entry records the bytecode position and AST node tag of one rule.
The end of a rule's address range is the next entry's `start_addr` (or
`code_len` for the last rule). Used to map a return address on the call
stack back to the rule tag.

**`sync[]`** — `{rule_tag, token}` entries. `token` uses the same
encoding as the assembler's `.sync` directive:

```
bit 23 = 0 -> bits 22–0 are a bitmap-table index (single-byte tokens)
bit 23 = 1 -> bits 22–0 are a string-table index (multi-byte string)
```

Single-byte tokens should be packed into a single bitmap per rule. Each
multi-byte string token gets its own entry.

##### B.7.2. Recovery behaviour

The recovery trigger is the **fail handler when `bt_sp == 0`** (no
backtrack options remain and the VM is about to set `matched = 0`).

```
if bt_sp == 0 && nsync > 0:
    // 1. Walk call stack innermost-first, collecting sync tokens
    //    and recording the innermost sync-decorated rule.
    recovery_tokens = empty set
    innermost_sync_frame = -1      // call-stack index
    innermost_sync_addr = -1       // rule entry address

    for i = call_sp - 1 down to 0:
        return_ip = call_stack[i]
        rule_tag = lookup_rule_by_address(return_ip)
        token    = lookup_sync_by_tag(rule_tag)
        if token != NOT_FOUND:
            if innermost_sync_frame == -1:
                innermost_sync_frame = i
                innermost_sync_addr = lookup_rule_entry(rule_tag)
            if token not already in recovery_tokens:
                add token to recovery_tokens

    if innermost_sync_frame == -1:
        set matched = 0, exit        // no sync rule on stack

    // 2. Scan forward for any collected token
    for each position p from current pos to EOF:
        for each token in recovery_tokens:
            if token.type == bitmap && bitmap[token.index] has bit set for input[p]:
                pos = p + 1
                goto RECOVER
            if token.type == string && input[p..] starts with string_table[token.index]:
                pos = p + strlen(string_table[token.index])
                goto RECOVER

    // no sync token found -> definitive failure
    set matched = 0, exit

RECOVER:
    // truncate call stack to the caller of the sync rule
    call_sp = innermost_sync_frame

    // Optional, push an Error node in the AST.
    push AstNode(ERROR) to node_stack

    // reset remaining VM stacks
    cap_sp  = 0
    bt_sp   = 0

    // restart from the sync rule's entry
    ip = call_stack[innermost_sync_frame]
    set matched = 1
    continue execution
```

`lookup_rule_by_address(addr)` performs a binary search over the sorted
`rules[]` table to find the entry where `entry.start_addr ≤ addr < next.start_addr`.

`lookup_sync_by_tag(tag)` performs a linear scan over the `sync[]` table
to find the first entry matching `tag`.

##### B.7.3. Conflict resolution

When multiple rules on the call stack have `@sync` decorators, all their
tokens are collected (step 1 iterates innermost-first). If the same token
appears in multiple rules, the innermost rule's entry is added first and
the check `token not already in recovery_tokens` prevents outer rules from
overriding it. This gives inner rules priority for conflicting tokens.

##### B.7.4. Relationship with CUT

`I_CUT` and the sync metadata are independent:
- `I_CUT` commits a choice and populates diagnostic data on failure.
- The sync table enables recovery when no backtrack options remain.

When both are used:
1. Instruction fails after a cut.
2. Diagnostic data is populated (see B.6.1).
3. Backtrack unwinds. If `bt_sp` reaches 0, recovery fires.
4. The parser retries from the innermost sync rule's entry at the new
   input position.
5. Further errors may be found and reported similarly.

---

### Appendix C: Reference VM Implementation (Python)

The following Python code implements the PegVM interpreter, bytecode
loader, and error-recovery logic as specified in this document. It is
intended as a readable reference — not optimised, but complete.

```python
import struct
from enum import IntEnum
from dataclasses import dataclass, field
from typing import Optional, List, Tuple, Dict


# ── Opcodes ────────────────────────────────────────────────────────────────

class Op(IntEnum):
    CHAR = 0;       ANY = 1;        RANGE = 2
    SET = 3;        LIT = 4;        SPAN = 5
    JUMP = 6;       CALL = 7;       RET = 8
    CHOICE = 9;     COMMIT = 10;    PARTIAL = 11
    FAIL = 12;      CUT = 13;       TRUE = 14
    END = 15;       NODE = 16;      POP = 17
    CAP = 18;       CAP_END = 19


def i_encode(op: int, arg: int) -> int:
    return (op << 24) | (arg & 0x00FFFFFF)


def i_decode(word: int) -> Tuple[int, int]:
    return (word >> 24) & 0xFF, word & 0x00FFFFFF


SARG_MAX = 0x7FFFFF  # sign-extension limit for 24-bit signed


def sarg(arg: int) -> int:
    return arg if arg < SARG_MAX else arg - 0x1000000


# ── AST node ───────────────────────────────────────────────────────────────

@dataclass
class AstNode:
    tag: int
    soff: int = 0  # source start offset
    seoff: int = 0  # source end offset
    children: List['AstNode'] = field(default_factory=list)


# ── Diagnostic ─────────────────────────────────────────────────────────────

@dataclass
class PegDiagnostic:
    error_tag: str = ""
    failed_rule: str = ""
    expected_token: str = ""
    error_offset: int = 0
    line: int = 0
    column: int = 0


# ── Bitmap helpers ─────────────────────────────────────────────────────────

def bitmap_set(bitmap: list, byte_val: int) -> bool:
    """Test if bit `byte_val` is set in an 8-uint32 bitmap."""
    if byte_val < 0 or byte_val > 255:
        return False
    idx = byte_val // 32
    bit = byte_val % 32
    return bool(bitmap[idx] & (1 << bit))


# ── Bytecode loader ────────────────────────────────────────────────────────

@dataclass
class Bytecode:
    code: list  # list of uint32 instruction words
    bitmaps: list  # list of 8-uint32 lists
    strings: list  # list of byte strings
    rules: list  # list of (start_addr, tag)
    sync: list  # list of (rule_tag, token_word)


def load_pegrc(path: str) -> Bytecode:
    with open(path, "rb") as f:
        magic = struct.unpack("<I", f.read(4))[0]
        assert magic == 0x00524750, "bad magic"
        code_len = struct.unpack("<I", f.read(4))[0]
        nbitmaps = struct.unpack("<I", f.read(4))[0]
        nstrings = struct.unpack("<I", f.read(4))[0]
        nrules = struct.unpack("<I", f.read(4))[0]
        nsync = struct.unpack("<I", f.read(4))[0]

        code = list(struct.unpack(f"<{code_len}I", f.read(4 * code_len)))

        bitmaps = []
        for _ in range(nbitmaps):
            bm = list(struct.unpack("<8I", f.read(32)))
            bitmaps.append(bm)

        strings = []
        for _ in range(nstrings):
            buf = bytearray()
            while True:
                b = f.read(1)
                if not b or b == b"\x00":
                    break
                buf.extend(b)
            strings.append(bytes(buf))
            # align to 4-byte boundary
            pad = (4 - (len(buf) + 1) % 4) % 4
            f.read(pad)

        rules = []
        for _ in range(nrules):
            addr, tag, name_idx = struct.unpack("<III", f.read(12))
            rules.append((addr, tag, name_idx))

        sync = []
        for _ in range(nsync):
            rule_tag, token = struct.unpack("<II", f.read(8))
            sync.append((rule_tag, token))

    return Bytecode(code, bitmaps, strings, rules, sync)


# ── Recovery helpers (binary search on rules[], linear scan on sync[]) ────

def lookup_rule_by_address(rules: list, addr: int):
    """Binary search rules for the entry spanning `addr`."""
    lo, hi = 0, len(rules)
    while lo < hi:
        mid = (lo + hi) // 2
        if rules[mid][0] <= addr:
            lo = mid + 1
        else:
            hi = mid
    idx = lo - 1
    if idx < 0:
        return None
    start = rules[idx][0]
    end = rules[idx + 1][0] if idx + 1 < len(rules) else 1 << 30
    if start <= addr < end:
        return rules[idx][1]  # tag
    return None


def lookup_sync_by_tag(sync: list, tag: int):
    """Linear scan for the first sync entry with matching tag."""
    for rule_tag, token in sync:
        if rule_tag == tag:
            return token
    return None


def lookup_rule_entry(rules: list, tag: int):
    """Return the start address of the rule with the given tag."""
    for addr, t in rules:
        if t == tag:
            return addr
    return None


def sync_token_type(token: int):
    """Return ('bitmap', index) or ('string', index)."""
    if token & 0x800000:  # bit 23
        return "string", token & 0x7FFFFF
    else:
        return "bitmap", token & 0x7FFFFF


# ── VM ─────────────────────────────────────────────────────────────────────

@dataclass
class BacktrackFrame:
    pos: int
    ip: int
    node_sp: int
    call_sp: int
    cap_sp: int
    cap_pos: int


class PegVM:
    def __init__(self, bc: Bytecode):
        self.bc = bc
        self.source = ""  # input text
        self.pos = 0  # current input position
        self.ip = 0  # instruction pointer into bc.code
        self.matched = False  # whether the parse succeeded
        self.cut_tag = -1  # string-table index from most recent I_CUT
        self._cap_pos = 0
        self.last_diagnostic: Optional[PegDiagnostic] = None

        # stacks
        self.bt: List[BacktrackFrame] = []  # backtrack stack
        self.call: List[int] = []  # call stack (return IPs)
        self.node: List[AstNode] = []  # AST node stack
        self.cap: List[int] = []  # capture-position stack

        # tag -> name mapping (populated from rule tags, for diagnostics)
        self.tag_names: Dict[int, str] = {
            tag: bc.strings[name_idx].decode("latin-1", errors="replace")
            for _, tag, name_idx in bc.rules
        }

    # ── helpers ────────────────────────────────────────────────────────

    def _expected_token(self, op: int, arg: int) -> str:
        if op == Op.CHAR:
            return repr(chr(arg & 0xFF))
        if op == Op.LIT:
            return repr(self.bc.strings[arg].decode("latin-1", errors="replace"))
        if op == Op.RANGE:
            lo, hi = (arg >> 12) & 0xFFF, arg & 0xFFF
            return f"[{chr(lo)}–{chr(hi)}]"
        if op in (Op.SET, Op.SPAN):
            return f"<bitmap {arg}>"
        if op == Op.ANY:
            return "<any>"
        return "?"

    def _line_col(self) -> Tuple[int, int]:
        """Compute 1-based line/column from self.pos."""
        line = self.source[:self.pos].count("\n") + 1
        last_nl = self.source.rfind("\n", 0, self.pos)
        col = self.pos - (last_nl + 1) + 1
        return line, col

    def _fail(self, op: int, arg: int) -> bool:
        """Backtrack handler — called when an instruction fails."""
        # Populate diagnostic data on failure
        line, col = self._line_col()
        rule_tag = lookup_rule_by_address(self.bc.rules, max(0, self.ip - 1))
        rule_name = self.tag_names.get(rule_tag, f"Rule_{rule_tag}") if rule_tag is not None else "Unknown"
        err_tag = self.bc.strings[self.cut_tag].decode("latin-1", errors="replace") if self.cut_tag >= 0 else rule_name

        self.last_diagnostic = PegDiagnostic(
            error_tag=err_tag,
            failed_rule=rule_name,
            expected_token=self._expected_token(op, arg),
            error_offset=self.pos,
            line=line,
            column=col
        )

        if self.bt:
            frame = self.bt.pop()
            # free AST nodes below saved node_sp
            del self.node[frame.node_sp:]
            # restore state
            self.pos = frame.pos
            self.ip = frame.ip
            self.call = self.call[:frame.call_sp]
            self.node = self.node[:frame.node_sp]
            self.cap = self.cap[:frame.cap_sp]
            self._cap_pos = frame.cap_pos
            return True

        # bt_sp == 0  -> try recovery, then fail
        if self.bc.sync:
            self._recover()
            return True

        self.matched = False
        return False

    def _recover(self):
        """Error recovery: walk call stack, collect sync tokens, scan."""
        tokens = set()
        innermost_frame = -1

        # 1. Walk call stack to find sync tokens
        for i in range(len(self.call) - 1, -1, -1):
            ret_ip = self.call[i]
            tag = lookup_rule_by_address(self.bc.rules, ret_ip)
            if tag is None:
                continue
            tok = lookup_sync_by_tag(self.bc.sync, tag)
            if tok is not None:
                if innermost_frame == -1:
                    innermost_frame = i
                if tok not in tokens:
                    tokens.add(tok)

        if innermost_frame == -1:
            self.matched = False
            return

        # 2. Scan forward with strict forward-progress guarantee
        old_pos = self.pos
        for p in range(self.pos, len(self.source)):
            for tok in tokens:
                typ, idx = sync_token_type(tok)

                # Check Bitmap Token
                if typ == "bitmap":
                    byte_val = ord(self.source[p]) if p < len(self.source) else 0
                    if bitmap_set(self.bc.bitmaps[idx], byte_val):
                        new_pos = p + 1
                        if new_pos <= old_pos:
                            new_pos = old_pos + 1
                        self.pos = new_pos
                        self._recover_to(innermost_frame)
                        return

                # Check String Token
                else:
                    s = self.bc.strings[idx].decode("latin-1", errors="replace")
                    if self.source[p:p + len(s)] == s:
                        new_pos = p + len(s)
                        if new_pos <= old_pos:
                            new_pos = old_pos + 1
                        self.pos = new_pos
                        self._recover_to(innermost_frame)
                        return

        self.matched = False

    def _recover_to(self, frame_idx: int):
        """Abort the sync rule, pretend it matched, and return to its caller."""

        # 1. Preserve the AST! Append an ERROR node so the tree isn't missing a chunk.
        # (Assuming tag 255 or similar represents an ErrorNode in your system)
        self.node.append(AstNode(tag=255))

        # 2. Clear the backtrack stack (we are committed to this recovery)
        self.bt.clear()

        # 3. Simulate returning to the caller
        if frame_idx >= 0:
            # Grab the return IP of the caller
            ret_ip = self.call[frame_idx]
            # Truncate the call stack to remove the aborted rule AND the return IP we just popped
            self.call = self.call[:frame_idx]
            self.ip = ret_ip
            self.matched = True
        else:
            # If frame_idx == 0, the sync rule was the top-level root rule of the whole file.
            # There is no caller to return to. We just end the parse successfully.
            self.call.clear()
            self.ip = len(self.bc.code)  # Move IP to EOF
            self.matched = True

    # ── main interpreter loop ──────────────────────────────────────────

    def run(self, source: str) -> Optional[AstNode]:
        self.source = source
        self.pos = 0
        self.ip = 0
        self.matched = False
        self.cut_tag = -1
        self.last_diagnostic = None
        self.bt.clear()
        self.call.clear()
        self.node.clear()
        self.cap.clear()
        self._cap_pos = 0

        while True:
            word = self.bc.code[self.ip]
            op, arg = i_decode(word)
            self.ip += 1

            if op == Op.CHAR:
                if self.pos < len(self.source) and ord(self.source[self.pos]) == (arg & 0xFF):
                    self.pos += 1
                elif not self._fail(op, arg):
                    return None

            elif op == Op.ANY:
                if self.pos < len(self.source):
                    self.pos += 1
                elif not self._fail(op, arg):
                    return None

            elif op == Op.RANGE:
                lo, hi = (arg >> 12) & 0xFFF, arg & 0xFFF
                if self.pos < len(self.source):
                    b = ord(self.source[self.pos])
                    if lo <= b <= hi:
                        self.pos += 1
                    else:

                        if not self._fail(op, arg):
                            return None
                elif not self._fail(op, arg):
                    return None

            elif op == Op.SET:
                if self.pos < len(self.source):
                    b = ord(self.source[self.pos])
                    if bitmap_set(self.bc.bitmaps[arg], b):
                        self.pos += 1
                    elif not self._fail(op, arg):
                        return None
                elif not self._fail(op, arg):
                    return None

            elif op == Op.LIT:
                s = self.bc.strings[arg].decode("latin-1", errors="replace")
                if self.source[self.pos:self.pos + len(s)] == s:
                    self.pos += len(s)
                elif not self._fail(op, arg):
                    return None

            elif op == Op.SPAN:
                bm = self.bc.bitmaps[arg]
                while self.pos < len(self.source):
                    b = ord(self.source[self.pos])
                    if bitmap_set(bm, b):
                        self.pos += 1
                    else:
                        break
                # SPAN always succeeds

            elif op == Op.JUMP:
                self.ip += sarg(arg)

            elif op == Op.CALL:
                self.call.append(self.ip)
                self.ip += sarg(arg)

            elif op == Op.RET:
                if not self.call:
                    self.matched = True
                    break
                self.ip = self.call.pop()

            elif op == Op.CHOICE:
                frame = BacktrackFrame(
                    pos=self.pos, ip=self.ip + sarg(arg),
                    node_sp=len(self.node), call_sp=len(self.call),
                    cap_sp=len(self.cap), cap_pos=self._cap_pos,
                )
                self.bt.append(frame)

            elif op == Op.COMMIT:
                if self.bt:
                    self.bt.pop()
                self.ip += sarg(arg)

            elif op == Op.PARTIAL:
                if self.bt:
                    top = self.bt[-1]
                    top.pos = self.pos
                    top.node_sp = len(self.node)
                    top.cap_pos = self._cap_pos
                self.ip += sarg(arg)

            elif op == Op.FAIL:
                if not self._fail(op, arg):
                    return None

            elif op == Op.CUT:
                # Commit to active choice: discard the most recent backtrack frame
                # ONLY if it belongs to the current rule (same call depth).
                if self.bt and self.bt[-1].call_sp == len(self.call):
                    self.bt.pop()
                self.cut_tag = arg if arg > 0 else -1

            elif op == Op.TRUE:
                pass

            elif op == Op.END:
                self.matched = True
                break

            elif op == Op.NODE:
                self.node.append(AstNode(tag=arg))

            elif op == Op.POP:
                if self.node:
                    child = self.node.pop()
                    if self.node:
                        self.node[-1].children.append(child)

            elif op == Op.CAP:
                self.cap.append(self._cap_pos)
                self._cap_pos = self.pos

            elif op == Op.CAP_END:
                if self.node:
                    n = self.node[-1]
                    n.soff = self._cap_pos
                    n.seoff = self.pos
                if self.cap:
                    self._cap_pos = self.cap.pop()

            else:
                raise RuntimeError(f"unknown opcode {op} at ip {self.ip - 1}")

        # After main loop, return root AST node if matched
        if self.matched and self.node:
            return self.node[0]
        if self.matched:
            return AstNode(tag=0, soff=0, seoff=len(self.source))
        return None
```

Notes on the reference implementation:

*   **`_fail()`** implements the full backtrack logic (§4.5, §B.6.1).
    When `bt_sp == 0` it calls `_recover()` instead of immediately
    failing.

*   **`_recover()`** implements §B.7.2: walk the call stack innermost-
    first, collect sync tokens, scan forward, and restart from the
    innermost sync-decorated rule's entry.

*   **`CUT`** guarantees local scope by checking the call depth of the 
    top backtrack frame. By only popping a frame if it belongs to the 
    current rule (`call_sp == len(call_stack)`), it safely discards the 
    nearest alternative without corrupting outer choices or the 
    caller's backtrack state. Production implementations should mirror 
    this O(1) check.

*   **Stack management:** Python lists are used for all stacks.
    Backtrack saves and restores stack pointers (`len(list)`) rather
    than copying entries — the actual list content above the saved
    pointer is discarded on restore.

*   **Diagnostic data** (`PegDiagnostic`) is populated in `_fail()` when
    a cut is active. The reference implementation collects the fields
    but a full implementation would deliver them to the host via a
    callback.

*   **Rule/sync lookups** use the `rules[]` and `sync[]` tables loaded
    from the `.pegrc` file. `lookup_rule_by_address` performs a binary
    search; `lookup_sync_by_tag` performs a linear scan (the table is
    small).

| Version | Date           | Author(s)  | Changes         |
| :------ | :------------- | :--------- | :-------------- |
| 1.0.0   | 13 August 2026 | Madeleine  | Initial version |
