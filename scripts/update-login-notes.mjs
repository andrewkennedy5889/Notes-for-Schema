// Update Login Page feature (ID 43) with Web App notes
const notes = `## Login Page — Web App

Source: March Nexus src/app/auth/login/page.tsx (1,481 lines)

### Visual Design
- Full-black background (#0a0a0a), centered card (#111), rounded-lg, border #333
- Header: "Nexus" bold white centered
- Tab toggle: "Sign In" / "New Account / Org" — active tab gold (#FCC30A) with gold underline, inactive gray #888
- Inputs: dark bg #181818, border #333, rounded-lg, gold focus ring
- Primary CTA: full-width gold #FCC30A button, black text

### Sign In Tab
- Email field (placeholder: you@example.com)
- Password field (masked)
- "Forgot password?" link — sends Supabase reset email, shows green success banner
- "Sign In" button — calls supabase.auth.signInWithPassword
- Error: red banner below fields
- Post-login: checks if user has multiple orgs → redirect to /auth/select-org, otherwise /dashboard

### New Account / Org Tab (2-step wizard)
**Step 1 of 2:**
- Full Name field (hidden if email already exists)
- Email field
- Gray circle arrow button → turns gold when valid (name + valid email)
- Email check: GET /api/auth/check-email — if exists, shows yellow banner with existing orgs + "Send Password Reset" + "Create or Join Additional Organization" options
- Email validation: regex + TLD length check (2-10 chars)

**Step 2 of 2:**
- "< Back" link (returns to step 1) + "Step 2 of 2" label
- Password field with "Minimum 8 characters" hint in gold
- Domain-based org matching: extracts domain from email, calls GET /api/auth/organizations?domain=...
  - If match found: shows org name + logo, user auto-joins on signup
  - If no match: shows company search field
- "Search Company" field with autocomplete dropdown:
  - Calls GET /api/auth/business-listings?q=... (300ms debounce)
  - Results show logo + name + website
  - "+ My company isn't listed — add it manually" link at bottom
- Manual entry mode: Organization Name + Company Website fields
  - Conflict detection: checks name exact/similar + website exact against existing orgs
  - Hard blocks if exact name or website match exists
- Submit: creates Supabase auth user → calls POST /api/auth/signup with profile + org data → shows email confirmation screen

### Email Confirmation Screen
- Email emoji, "Check your email" heading
- Shows email address
- Warning: open confirmation link on same device
- "Back to Sign In" link

### Join Additional Org Flow (existing users)
- Requires password verification first
- Choose: "Create New Organization" or "Join Existing Organization"
- Domain auto-match shown if found
- Create: same company search/manual flow as signup step 2
- Join: search by website URL → if found, sends join request or auto-joins
- Max 3 organizations per user

### Theme Constants
- GOLD: #FCC30A
- BG_CARD: #111
- BORDER: #333
- TEXT_MUTED: #888
- TEXT_WHITE: #fff
- BG_INPUT: #181818

### Auth Backend (Supabase)
- supabase.auth.signInWithPassword for login
- supabase.auth.signUp for registration
- supabase.auth.resetPasswordForEmail for password reset
- User type always "individual" at signup — qualifying phase determines real level
- Session: Supabase manages JWT + refresh tokens`;

const res = await fetch("http://localhost:3100/api/schema-planner", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "_splan_features",
    id: 43,
    data: { notes, status: "Approved" },
    reasoning: "Added comprehensive Web App notes from source code analysis, updated status to Approved",
  }),
});
const data = await res.json();
console.log("Updated feature:", data.featureId, "Status:", data.status);
console.log("Notes length:", data.notes?.length, "chars");
