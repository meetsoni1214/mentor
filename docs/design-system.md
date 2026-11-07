# Web design system

The browser shares one brand definition and one set of design tokens. Shared
controls use local shadcn/ui components. Features own their layout and behavior;
branding is imported from `src/brand/`.

## Change the brand in one place

| Change                                                                             | Source                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Product name, monogram, page description                                           | `apps/web/src/brand/brand.ts`                              |
| Logo rendering and name/logo lockup                                                | `apps/web/src/brand/brand-logo.tsx` and `brand.module.css` |
| Brand colors, neutral palette, semantic colors, typography, spacing, radii, motion | `apps/web/src/brand/tokens.css`                            |

`brand.ts` has no React or browser dependencies, so the server-rendered page
metadata and browser components use the same name and description. Labels,
placeholders, assistant names, and branded error messages read `brand.name`.
Sign-in and the workspace use `BrandLockup`; empty states use `BrandLogo`.

```tsx
import { brand } from '@/brand/brand';
import { BrandLockup, BrandLogo } from '@/brand/brand-logo';

<BrandLockup />;
<BrandLogo size="lg" decorative />;
<label>Message {brand.name}</label>;
```

Use a decorative logo beside visible brand text to avoid repeating the accessible
name. A standalone `BrandLogo` defaults to an accessible image with the brand's
name. Its size changes through a typed prop; screens do not recreate the monogram.

## Use semantic tokens

The root layout loads `tokens.css` once. Raw color codes belong only in that file.
Feature styles refer to roles rather than copying palette values:

```css
.panel {
  background: var(--color-surface);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
}
```

`--brand-primary`, `--brand-primary-hover`, and `--brand-on-primary` define the
brand's action colors. Buttons, the logo, focus rings, and outgoing-message tokens
reference them. Body text, backgrounds, and borders use separate neutral tokens,
so changing the accent does not recolor every text label. The default is monochrome.
Feature-specific widths, bubble alignment, and scrolling remain feature layout.

## Reuse controls

The Radix-based shadcn `new-york` components live in
`apps/web/src/components/ui/`. Their source is checked in and can be customized:

| Primitive                                                 | Current use                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `Button`                                                  | Sign-in/out, refresh, pagination, delivery recovery, Send   |
| `Input`, `Label`                                          | Sign-in credentials and accessible field names              |
| `Textarea`                                                | Controlled conversation composer                            |
| `Alert`, `AlertDescription`                               | Authentication errors, availability notices, refresh errors |
| `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | Keyboard-accessible run details                             |

These are adapted from the [official shadcn registry](https://ui.shadcn.com/docs/registry).
`Button` retains shadcn's variants and `asChild` composition. Our defaults use the
shared action colors, existing control sizes, and `type="button"` to prevent
accidental submission. Inputs preserve native form behavior. Run details use
Radix's expanded state, trigger/content association, and keyboard interaction.
Icons use Lucide.

```tsx
import { Button } from '@/components/ui/button';

<Button type="submit" className="w-full">
  Sign in
</Button>;
<Button variant="outline" size="sm">
  Sign out
</Button>;
<Button variant="ghost" size="sm">
  Refresh
</Button>;
<Button size="icon" disabled aria-label="Send message">
  …
</Button>;
```

Tailwind v4 runs through `postcss.config.mjs`. `globals.css` maps shadcn roles
such as `primary`, `background`, `border`, and `ring` to `brand/tokens.css`.
Brand colors remain defined there; components use semantic utilities such as
`bg-primary` and `text-muted-foreground`. Control text sizes map to the shared
typography tokens too. `cn()` in `lib/utils.ts` combines classes
and resolves competing Tailwind utilities, so `className` can override defaults.
Feature CSS and the shared logo CSS Module remain responsible for their layout.

Add components from the web workspace using the configured aliases:

```sh
pnpm dlx shadcn@latest add dialog -c apps/web
```

Review generated changes before accepting them, especially changes to the token
file or customized primitives. Prefer an existing shadcn primitive when it fits;
keep conversation bubbles, history ordering, scroll preservation, and session
handling in their feature modules. There is no need to turn message prose into
cards or replace the native transcript scroller.

The composer supports sending and in-memory delivery recovery. Its form controls
reflect pending, uncertain, unavailable, and running states through the same
primitives. The owner removed its
cloud-processing line and Privacy & context section; the design system does not
restore either. Provider processing and retention are documented in the
[conversation guide](conversation-loop.md#cloud-processing-disclosure-and-current-capability-boundary).

## Verification

The shared-brand/shadcn checkpoint passed `pnpm check`, including all 252 tests,
generated contracts, and the production build. Production browser checks exercise
the shared sign-in/workspace branding, native button types, and changing the
primary token across logos, controls, outgoing bubbles, and focus rings while
neutral text remains unchanged. The conversation regression checks also cover
pagination, keyboard use, errors, disabled sending, and phone/desktop layouts
with synthetic API responses. UI dependencies now include Tailwind, Radix
primitives, class-variance-authority, clsx, tailwind-merge, and Lucide. Database
integration and live provider calls are outside this frontend migration.

The shadcn migration passed 28 browser scenarios using synthetic responses,
including Enter/Space toggling and expanded-state announcements for run details,
associated sign-in labels, shared Input/Textarea use, the minimal header, and the
existing conversation regression checks. Screenshots and the acceptance script
are kept under the ignored `output/playwright/conversation-ui/` directory.

The sending slice repeats these 28 browser regressions with the enabled composer
and adds 29 sending/recovery scenarios. Controls remain the same local shadcn
primitives; sending state and recovery belong to the conversation feature.
