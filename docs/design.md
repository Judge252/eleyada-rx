# Phase 1 design reference lock

Direct local build based on the supplied logo, palette, Arabic RTL requirements and narrowly scoped Phase 1 brief. Live Refero styles were attempted but returned `NO_SUBSCRIPTION`; no live reference screens were available or claimed.

The bundled Refero typography, color and craft-details guides provide the fallback references: neutral typography for work tools, restrained semantic color, explicit labels and errors, visible keyboard focus, fixed image dimensions, and native links/buttons. The visual-workflow guide supplies the post-build visual QA criteria.

| Decision | Source and role | Implementation |
| --- | --- | --- |
| Navy navigation and primary actions | User's `#102D55` brand color | Persistent right sidebar on desktop, collapsible navigation on mobile |
| Pale green canvas, white content | User's `#F5F9F5` and `#FFFFFF` | Quiet workspace and thin bordered panels; no decorative gradients |
| Clinic green accents | User's `#65AD43`, Refero color guide | Active navigation marker, focus outlines and restrained green status accents; darker semantic text for contrast |
| Single Arabic font family | Arabic-first brief, Refero typography guide | Self-hosted Noto Sans Arabic Variable; no runtime Google Fonts requests |
| Table-first dashboard | Requested statistics and recent prescriptions | Derived mock counts, fictional identities, demo codes and explicit status words |
| Local form then local review | Requested form and review action, craft-details guide | Inline validation, first-error focus, preserved edit state; no save/issue action |
| Read-only pharmacy document | User's medication integrity requirement | Same document renderer with no editable controls; identity checkbox and explicit local simulation confirmation |
| Original brand asset | User's explicit logo requirement | Byte-identical copy at `public/branding/logo.png`, contained at its original aspect ratio on white |
| Visible demo context | User's mock-only/legal-validity constraints | Sidebar preview links, global demo notice, document warning and persistent print disclaimer |

Preserve the navy/green hierarchy, Arabic typography, right-side desktop navigation, clean table rows and original logo. Reject generated branding, fabricated clinical advice, real account claims, unnecessary imagery, animation and decorative complexity. Use Lucide for interface icons only.

Visual QA compares actual Chromium screenshots at 320, 768 and 1440 px against this lock, including print emulation. Functional and verification evidence is recorded in `verification.md` after the checks run.
