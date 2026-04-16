// Create cross-feature test cases on Login Page (43) that depend on Color Palette (44)
const FEATURE_ID = 43;
const DEP_FEATURE_ID = 44;

const tests = [
  {
    title: "Login card renders with org brand colors via branded URL",
    testType: "integration",
    expectedResult: "User arrives via org-specific URL → login card uses that org's color1 for Sign In button and color2 for accents instead of default gold",
    dependencies: [DEP_FEATURE_ID],
    sortOrder: 20,
  },
  {
    title: "Sign In button uses org color1 as background",
    testType: "unit",
    expectedResult: "When org context is present, Sign In button background = org.color1, text auto-contrasts via deriveTheme",
    dependencies: [DEP_FEATURE_ID],
    sortOrder: 21,
  },
  {
    title: "Default theme colors applied when no org context",
    testType: "unit",
    expectedResult: "No org branding available (direct /auth/login access) → falls back to default gold (#FCC30A) theme, not broken/unstyled",
    dependencies: [DEP_FEATURE_ID],
    sortOrder: 22,
  },
];

for (const test of tests) {
  const res = await fetch("http://localhost:3100/api/schema-planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "_splan_feature_tests",
      data: { featureId: FEATURE_ID, ...test, status: "draft" },
      reasoning: `Cross-feature test: Login Page depends on Color Palette`,
    }),
  });
  const data = await res.json();
  console.log(`✓ Test #${data.testId}: ${data.title} (deps: [${DEP_FEATURE_ID}])`);
}

console.log(`\nDone — ${tests.length} cross-feature tests created`);
