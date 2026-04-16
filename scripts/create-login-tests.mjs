// Create test cases for Login Page feature (ID 43)
const FEATURE_ID = 43;

const tests = [
  { title: "Valid login redirects to dashboard", testType: "acceptance", expectedResult: "User enters valid email + password → redirected to /dashboard", sortOrder: 0 },
  { title: "Invalid credentials show error", testType: "acceptance", expectedResult: "Wrong password → red error banner displayed, no redirect occurs", sortOrder: 1 },
  { title: "Empty fields show validation", testType: "unit", expectedResult: "Submit with empty email or password → error message shown", sortOrder: 2 },
  { title: "Forgot password sends reset email", testType: "acceptance", expectedResult: "Enter email, click Forgot password → green success banner: 'Password reset email sent'", sortOrder: 3 },
  { title: "Multi-org user redirects to org picker", testType: "integration", expectedResult: "User with 2+ orgs signs in → redirected to /auth/select-org instead of /dashboard", sortOrder: 4 },
  { title: "Advance button disabled until valid", testType: "unit", expectedResult: "Gray circle arrow until both Full Name + valid email filled → turns gold and clickable", sortOrder: 5 },
  { title: "Email validation catches bad formats", testType: "unit", expectedResult: "'user@site' or 'user@site.comgarbage' → error shown, does not advance to step 2", sortOrder: 6 },
  { title: "Existing email shows account banner", testType: "integration", expectedResult: "Email already in system → yellow banner with org list + 'Send Password Reset' + 'Create or Join' options", sortOrder: 7 },
  { title: "Password minimum 8 characters enforced", testType: "unit", expectedResult: "Password < 8 chars → cannot submit, hint 'Minimum 8 characters' visible", sortOrder: 8 },
  { title: "Domain-based org auto-match", testType: "integration", expectedResult: "Email @usadebusk.com → auto-detects USA DeBusk org, user auto-joins on signup", sortOrder: 9 },
  { title: "Company search autocomplete works", testType: "acceptance", expectedResult: "Type 'usa' in Search Company → dropdown shows matching companies with logos and URLs", sortOrder: 10 },
  { title: "Manual company entry with conflict detection", testType: "integration", expectedResult: "Enter existing company name → hard block shown, cannot create duplicate org", sortOrder: 11 },
  { title: "Signup shows email confirmation screen", testType: "acceptance", expectedResult: "Complete signup → email emoji + 'Check your email' screen with correct email address", sortOrder: 12 },
  { title: "Password verification required before join", testType: "acceptance", expectedResult: "Must enter current password and verify before accessing create/join org options", sortOrder: 13 },
  { title: "Max 3 organizations enforced", testType: "unit", expectedResult: "User with 3 orgs → 'Create or Join' option hidden, shows 'Maximum of 3 organizations reached'", sortOrder: 14 },
  { title: "Password never visible in plain text", testType: "unit", expectedResult: "Input type='password' on all password fields, no cleartext exposed in DOM", sortOrder: 15 },
  { title: "Rate limiting handled gracefully", testType: "acceptance", expectedResult: "Supabase rate limit error → shows confirmation screen gracefully, not a crash or raw error", sortOrder: 16 },
];

for (const test of tests) {
  const res = await fetch("http://localhost:3100/api/schema-planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "_splan_feature_tests",
      data: { featureId: FEATURE_ID, ...test, status: "draft" },
      reasoning: `Test case for Login Page: ${test.title}`,
    }),
  });
  const data = await res.json();
  console.log(`✓ Test #${data.testId}: ${data.title} (${data.testType})`);
}

console.log(`\nDone — ${tests.length} test cases created for feature ${FEATURE_ID}`);
