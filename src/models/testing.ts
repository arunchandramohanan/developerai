/**
 * Port of com.bmo.devai.intellij.models.generation (GeneratedTest, TestMethod, TestFramework).
 */

/** Supported test frameworks for test generation. */
export enum TestFramework {
  JUNIT5 = "JUNIT5",
  JUNIT4 = "JUNIT4",
  TESTNG = "TESTNG",
  MOCKITO = "MOCKITO",
  ASSERTJ = "ASSERTJ",
  UNKNOWN = "UNKNOWN",
}

const FRAMEWORK_DISPLAY_NAME: Record<TestFramework, string> = {
  [TestFramework.JUNIT5]: "JUnit 5",
  [TestFramework.JUNIT4]: "JUnit 4",
  [TestFramework.TESTNG]: "TestNG",
  [TestFramework.MOCKITO]: "Mockito",
  [TestFramework.ASSERTJ]: "AssertJ",
  [TestFramework.UNKNOWN]: "Unknown",
};

export function testFrameworkDisplayName(fw: TestFramework): string {
  return FRAMEWORK_DISPLAY_NAME[fw];
}

/** Detects the JVM test framework from a blob of import statements. Defaults to JUnit 5. */
export function detectFrameworkFromImports(imports: string): TestFramework {
  if (imports.includes("org.junit.jupiter")) return TestFramework.JUNIT5;
  if (imports.includes("org.testng")) return TestFramework.TESTNG;
  if (imports.includes("org.junit") && !imports.includes("org.junit.jupiter")) return TestFramework.JUNIT4;
  return TestFramework.JUNIT5;
}

/**
 * Port of com.bmo.devai.intellij.models.generation.TestMethod. Kept for model
 * fidelity with the Java plugin; the SDK-driven generation flow (like the
 * Java GeneratedTest.of() factory it mirrors) always produces an empty list —
 * the LLM's output is treated as an opaque file body, not parsed into
 * individual method records.
 */
export enum TestType {
  UNIT = "UNIT",
  INTEGRATION = "INTEGRATION",
  EDGE_CASE = "EDGE_CASE",
  EXCEPTION = "EXCEPTION",
  BOUNDARY = "BOUNDARY",
  NULL_CHECK = "NULL_CHECK",
  PARAMETRIZED = "PARAMETRIZED",
}

export interface TestMethod {
  name: string;
  body: string;
  targetMethod?: string | null;
  testType: TestType;
  assertions: string[];
  description?: string | null;
  dependencies: string[];
}

/** Port of com.bmo.devai.intellij.models.generation.GeneratedTest. */
export interface GeneratedTest {
  className: string;
  packageName?: string | null;
  content: string;
  testMethods: TestMethod[];
  framework: TestFramework;
  targetClassName: string;
  suggestedFilePath: string;
  generatedAt: number;
  detectedFrameworkLabel?: string | null;
}

/** Port of GeneratedTest.of(...) — always starts with empty testMethods/imports. */
export function newGeneratedTest(
  className: string,
  packageName: string | null,
  content: string,
  framework: TestFramework,
  targetClassName: string,
  suggestedFilePath: string,
  detectedFrameworkLabel: string | null = null
): GeneratedTest {
  return {
    className,
    packageName,
    content,
    testMethods: [],
    framework,
    targetClassName,
    suggestedFilePath,
    generatedAt: Date.now(),
    detectedFrameworkLabel,
  };
}

/** Port of GeneratedTest.frameworkDisplayName(). */
export function frameworkDisplayNameFor(test: GeneratedTest): string {
  if (test.detectedFrameworkLabel && test.detectedFrameworkLabel.trim().length > 0) {
    return test.detectedFrameworkLabel;
  }
  return testFrameworkDisplayName(test.framework);
}

/** Port of GeneratedTest.getFullQualifiedName(). */
export function fullQualifiedName(test: GeneratedTest): string {
  if (!test.packageName || test.packageName.trim().length === 0) return test.className;
  return `${test.packageName}.${test.className}`;
}
