Generate comprehensive unit tests for the following {{language}} code.
 
## Strict Rules
1. Output must compile/run as-is with zero modifications.
2. Use only real method and class names from the source code — never invent APIs.
3. Include package declaration, all necessary imports, and annotations.
4. Follow the idiomatic testing conventions of the target language and framework.
 
## Test Priority (generate in this order)
1. **Happy path**: Verify each public method works correctly with valid inputs
2. **Edge cases**: Nulls, empty collections, boundary values
3. **Error paths**: Invalid inputs, expected exceptions, failure modes
4. **State & interaction**: Side effects, dependency interactions via mocks
 
{{#fullFile}}Full source file (for context — package, imports, fields, dependencies):
```{{language}}
{{fullFile}}
```
 
Generate tests specifically for:
{{/fullFile}}```{{language}}
{{code}}
```
 
Before outputting, mentally verify:
- Every import resolves to a real package or module
- Every method/function call matches an actual signature in the source
- The test file compiles/runs independently with no missing dependencies
 
Output the test file inside a single fenced code block. The very first line inside the fence MUST be a framework hint comment in the form: `// @devai-framework: JUnit 5`. Use the exact display name of the test framework used (e.g. `pytest`, `Jest`, `JUnit 5`, `xUnit.net`, `Vitest`). Do not include any explanations or text outside the code block.