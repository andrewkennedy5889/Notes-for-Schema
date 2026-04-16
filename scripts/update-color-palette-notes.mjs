// Update Business Listings Color Palette feature (ID 44) with Web App notes
const notes = `## Business Listings Color Palette — Web App

Source: March Nexus branding system across multiple files

### Architecture Overview
4 brand colors per organization → deriveTheme() generates 27 CSS custom properties → applied to :root → cascades to all components via var(--color-*)

### The 4 Brand Colors (stored in organizations table)
- color1: Primary — buttons, active nav, links (default: #2563eb)
- color2: Secondary — sidebar background, accents (default: #1e40af)
- color3: Background — page & card backgrounds (default: #f8fafc)
- color4: Text — dark text & accents (default: #1e293b)

### Key Files
- src/lib/branding/context.tsx (767 lines) — BrandingContext, deriveTheme(), applyTheme(), color math helpers
- src/lib/branding/color-extractor.ts — Logo analysis via k-means clustering, auto-extract 4 colors from logo image
- src/app/admin/page.tsx — Admin UI with 4 color pickers, live preview, contrast checking
- src/app/api/admin/branding/route.ts — GET/PUT branding API, syncs metadata to business_listings
- src/app/globals.css — 27 CSS variable defaults

### deriveTheme() — 4 Colors → 27 CSS Variables
Takes (c1, c2, c3, c4, mode) and generates:
- --color-primary, --color-primary-hover, --color-primary-text
- --color-secondary, --color-secondary-hover
- --color-background, --color-surface
- --color-text, --color-text-muted, --color-text-secondary, --color-text-tertiary
- --color-border, --color-sidebar-text, --color-sidebar-border
- --color-accent, --color-card, --color-card-hover
- --color-row-even, --color-row-odd
- --color-progress-track, --color-divider, --color-input-bg, --color-input-border
- --color-success-bg, --color-success-text
- --color-danger-bg, --color-danger-text

Light mode: direct mapping + lighten/darken steps
Dark mode: blends c2 into dark base (#0f1117), ensures WCAG 3:1 minimum contrast

### Color Extraction from Logo
Algorithm in color-extractor.ts:
1. Load image onto canvas (100x100px)
2. Sample pixels, skip transparent + near-white/near-black
3. K-means clustering (6 clusters) to find dominant colors
4. Score by vibrancy: saturation * (1 - |luminance - 0.45| * 1.5)
5. Assign roles: color1=most vibrant, color2=2nd, color3=light tint of primary, color4=dark shade of secondary
6. Auto-fix contrast via WCAG AA (4.5:1)

### Admin UI for Color Management
Located in src/app/admin/page.tsx:
- Simple vs Advanced mode toggle
- 4 visual color pickers (type="color") + hex text inputs
- "Re-extract from logo" button
- Live dual light/dark preview with contrast ratio badges
- Contrast fix modal: shows failing pairings, auto-fix button, manual suggestions

### WCAG Contrast Handling
- luminance() — WCAG 2.1 relative luminance calculation
- ensureContrast(fg, bg, minRatio) — progressively adjusts until contrast >= minRatio
- autoFixContrast() — ensures color3/color4 meet 4.5:1 (WCAG AA)
- fixBrandContrast() — multi-pass algorithm with detailed change tracking
- Semantic color shifting: if brand hue overlaps red → danger shifts orange; if overlaps green → success shifts teal

### Business Listings Sync
- business_listings table has NO color fields
- Branding PUT endpoint syncs org name, logo URL, website to linked business_listings row
- One-way sync: org → business_listing (non-critical, console.error on failure)
- Linkage: business_listings.orgId = organizations.id

### Data Flow
1. User uploads logo or enters 4 hex colors in Admin page
2. PUT /api/admin/branding saves to organizations table
3. Syncs metadata to linked business_listings row
4. OrgBrandingProvider context re-fetches
5. useEffect triggers deriveTheme(c1, c2, c3, c4, mode)
6. applyTheme() sets 27 CSS variables on document.documentElement
7. All components using var(--color-*) re-render with new theme

### Color Math Utilities
- hexToRgb(), rgbToHex() — conversion
- lighten(hex, pct), darken(hex, pct) — brightness adjustment
- blend(hex1, hex2, weight) — color blending
- hexToHue(), hueDist() — hue analysis for semantic shifting
- Light/dark mode stored in localStorage (opmap-theme)

### Kendo UI Reference Colors
#428bca (blue-info), #5bc0de (cyan), #5cb85c (green), #f2b661 (warning), #e67d4a (orange), #da3b36 (red)
These are reference colors, not hardcoded — the system accepts any 4 hex colors with automatic WCAG validation.`;

const res = await fetch("http://localhost:3100/api/schema-planner", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "_splan_features",
    id: 44,
    data: { notes, status: "Approved" },
    reasoning: "Added comprehensive Web App notes from source code analysis of branding system",
  }),
});
const data = await res.json();
console.log("Updated feature:", data.featureId, "Status:", data.status);
console.log("Notes length:", data.notes?.length, "chars");
