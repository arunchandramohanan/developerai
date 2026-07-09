Generate comprehensive unit tests for the following {{language}} code.
 
{{#framework}}Use the {{framework}} test framework.
 
{{/framework}}## Strict Rules
1. Output must compile/run as-is with zero modifications.
2. Use only real method and class names from the source code — never invent APIs.
3. Follow the idiomatic testing conventions of the target language and framework.
4. The source file is named `{{sourceFileName}}` (module `{{sourceModuleName}}`). Import the code under test from the *sibling* source file, NOT from a guessed package path:
   - **Python**: `from {{sourceModuleName}} import <symbols>` (the test will sit next to `{{sourceFileName}}`; do NOT prefix with `src.`, `app.`, the project name, or any folder).
   - **JavaScript / TypeScript**: `import { <symbols> } from './{{sourceModuleName}}'` (relative path, no extension).
   - **Go**: declare the same `package` as the source file; no import of the source needed.
   - **Java / Kotlin / Scala / Groovy**: use the same package declaration as the source file (visible in the source above).
 
## Test Priority (generate in this order)
1. **Happy path**: Verify each public method works correctly with valid inputs
2. **Edge cases**: Nulls, empty collections, boundary values
3. **Error paths**: Invalid inputs, expected exceptions, failure modes
4. **State & interaction**: Side effects, dependency interactions via mocks
 
## Requirements
- Use the idiomatic test-naming convention for {{language}} (e.g. `test_<function>_<scenario>` in Python, `describe`/`it` in JavaScript/TypeScript, `Test<Func>_<Scenario>` in Go, `<method>_<Scenario>_<ExpectedBehavior>` in Java/JVM languages)
- Group tests by the function, method, or class under test
- Use mocks/fakes appropriate to {{language}} for dependencies
 
{{#fullFileContent}}Full source file (for context — imports, fields, dependencies):
```{{languageLower}}
{{fullFileContent}}
```
 
Generate tests specifically for this target code:
```{{languageLower}}
{{targetCode}}
```
{{/fullFileContent}}{{#simpleCode}}Code to test:
```{{languageLower}}
{{simpleCode}}
```
{{/simpleCode}}
 
Before outputting, mentally verify:
- Every import resolves to a real package or module
- Every method/function call matches an actual signature in the source
- The test file compiles/runs independently with no missing dependencies