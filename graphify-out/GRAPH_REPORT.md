# Graph Report - graph-src  (2026-11-07)

## Corpus Check
- 115 files · ~73,788 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .css 2)

## Summary
- 657 nodes · 1237 edges · 40 communities (28 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 29
- Community 30
- Community 31
- Community 34
- Community 35
- Community 37
- Community 38

## God Nodes (most connected - your core abstractions)
1. `next` - 32 edges
2. `scripts` - 25 edges
3. `react` - 17 edges
4. `startTestDatabase()` - 16 edges
5. `@playwright/test` - 13 edges
6. `DoctorWorkspace()` - 12 edges
7. `PharmacyPortal()` - 12 edges
8. `object()` - 12 edges
9. `lucide-react` - 11 edges
10. `api()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `review()` --indirect_call--> `input()`  [INFERRED]
  src/components/doctor/prescription-form.tsx → tests/draft-validation.test.mjs
- `save()` --indirect_call--> `input()`  [INFERRED]
  src/components/doctor/prescription-form.tsx → tests/draft-validation.test.mjs
- `Window` --references--> `DraftRecord`  [EXTRACTED]
  tests/ui/entry.tsx → src/lib/drafts/validation.ts
- `Window` --references--> `Review`  [EXTRACTED]
  tests/ui/entry.tsx → src/lib/issuance/validation.ts
- `Window` --references--> `Lifecycle`  [EXTRACTED]
  tests/ui/entry.tsx → src/lib/issuance/validation.ts

## Import Cycles
- None detected.

## Communities (40 total, 12 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (40): deleteDraft(), DraftResult, safeError(), saveDraft(), getDoctorDraft(), header, DraftInput, DraftItem (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (17): react-dom@19.3.1, react-dom, DraftDocument(), date(), IssuedDocument(), labels, blank(), PrescriptionForm() (+9 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (32): devDependencies, embedded-postgres@17.10.0-beta.17, eslint@^9.39.0, eslint-config-next@16.4.2, pg@8.23.1, @playwright/test@^1.56.0, prettier@3.6.2, supabase@2.121.0 (+24 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (13): @playwright/test, @supabase/supabase-js, boundedFetch(), credentials(), uiSignIn(), visit(), Ledger, headers (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (6): lucide-react@^0.468.0, lucide-react, demoDate, demoDoctor, prescriptions, statusLabels

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (25): scripts, build, db:advisors, db:migrations:check, db:types, db:types:check, dev, lint (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (8): typescript, drafts, drafts, js, code, drafts, code, ts

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (16): Context, LanguageProvider(), invalid(), setLocale(), LanguageSwitcher(), LocalizedElement(), T(), useI18n() (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (4): react, DeleteDraft(), DoctorRow, stateLabel

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (12): blankPatient, DoctorWorkspace(), restart(), emptyMedicine(), fields, Medicine, Eligible, END_STATES (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.10
Nodes (12): id, lifecycle, output, record, require, review, server, stamp (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (15): LoginForm(), Account, AppRole, roleHome(), validMembership(), AuthState, signIn(), getAccount (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (11): context(), counts(), dispense(), ids, issued(), lookup(), med(), scalar() (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (4): dynamic, POST(), response(), IssueConfirmation()

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (7): context(), doctor, fakeToken, pass, scalar(), seed(), session

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (8): asDoctor(), asOwner(), asPharmacist(), doctorSession, id, medication, tables, transaction()

### Community 18 - "Community 18"
Cohesion: 0.26
Nodes (12): cancel(), context(), counts(), denial(), draft(), ids, issue(), med() (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (10): context(), dispense(), id, issue(), scalar(), search(), select(), selected() (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.24
Nodes (9): DELETE, dynamic, errorStatus(), GET(), HEAD, PATCH, POST(), PUT (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (11): dependencies, @fontsource-variable/noto-sans-arabic@^5.2.8, @fontsource-variable/noto-sans-hebrew@^5.3.0, next@16.4.2, react@19.3.1, server-only@0.0.1, @supabase/ssr@0.12.7, @supabase/supabase-js@2.118.0 (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.38
Nodes (10): issue(), recover(), PharmacyPortal(), dispense(), find(), finish(), recover(), api() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (9): anon(), dispense(), failure, id, issue(), lookup(), scalar(), session (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.27
Nodes (4): dynamic, failure(), POST(), response()

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (4): freePort(), startTestDatabase(), draft(), scalar()

### Community 30 - "Community 30"
Cohesion: 0.28
Nodes (5): as(), context(), ids, medication(), payload()

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (4): en, he, scan(), sources

### Community 35 - "Community 35"
Cohesion: 0.40
Nodes (4): Medication, Prescription, PrescriptionDraft, PrescriptionStatus

## Knowledge Gaps
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Community 31` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 15`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 27`, `Community 28`, `Community 32`, `Community 33`?**
  _High betweenness centrality (0.331) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06883116883116883 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Community 9` to `Community 32`, `Community 33`, `Community 2`, `Community 3`, `Community 5`, `Community 8`, `Community 10`, `Community 12`, `Community 15`, `Community 20`, `Community 23`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0647342995169082 - nodes in this community are weakly interconnected._
- **Why does `scripts` connect `Community 6` to `Community 3`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06463414634146342 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._