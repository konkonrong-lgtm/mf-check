# mf-check

A preflight and diagnostic CLI for Salesforce Multi-Framework projects.

I built this while experimenting with Multi-Framework React and ran into a few
cases where a deployment succeeded but the app still wasn't ready to use.

For example, a CustomApplication can be deployed with the wrong configuration,
and GraphQL operations that work locally may not match the schema of the org
you're deploying to.

`mf-check` tries to catch those problems before deployment and make them easier
to diagnose when something is already broken.

## What it checks

Currently:

- Salesforce project discovery from `sfdx-project.json` package directories
- UI Bundle configuration and build output
- CustomApplication → UI Bundle linkage for internal apps
- Experience Cloud → UI Bundle linkage for customer-facing apps
- whether the CustomApplication is a Lightning app
- application visibility through Permission Sets or Profiles
- external `.graphql` operations and static inline Salesforce SDK `gql`
  documents against the target org's GraphQL schema
- GA migration residue
  - deprecated `@salesforce/sdk-data` dependencies
  - deprecated `UIBundleSettings` scratch configuration
  - Beta Data SDK `graphql()` calls
  - deprecated `AppLauncher` targets

Live schema results are cached for 5 minutes because Salesforce introspection
can be slow. Use `--refresh` together with `--target-org` to bypass the cache.

Inline GraphQL scanning supports direct named `gql` imports, including import
aliases, from `@salesforce/platform-sdk` and `@salesforce/platform-sdk/data` in
UI Bundle JS, JSX, TS, and TSX source. Templates containing `${...}` interpolation
aren't evaluated or partially validated; they are reported as a non-blocking
`UNKNOWN`. A source file that can't be read or parsed is a blocking `UNKNOWN`
because the scan scope couldn't be confirmed. Wrapper functions, re-exports,
variable aliases, and cross-template or cross-file fragment resolution aren't
followed for inline documents.

## Installation

Requires Node.js 22 or later.

```bash
npm install -g @konkonrong/mf-check
```

Live target-org validation also requires the Salesforce CLI (`sf`) and an authenticated Salesforce org.

## Usage

For local metadata checks:

```bash
mf-check check <project-path>
```

For a detailed diagnostic report:

```bash
mf-check doctor <project-path>
```

`doctor` shows all check results and provides additional details for failures,
warnings, and checks that could not be confirmed, including why they matter
and remediation when available.

In doctor output:

- `PASS` means the condition was confirmed.
- `FAIL` means a concrete problem was detected.
- `WARN` means a potential issue was detected that may need attention.
- `UNKNOWN` means the check could not be completed reliably.

To also validate GraphQL operations against an org:

```bash
mf-check check <project-path> --target-org <org-alias>
```

Detailed diagnostics can also use a target org:

```bash
mf-check doctor <project-path> --target-org <org-alias>
```

To ignore the cached schema:

```bash
mf-check check <project-path> --target-org <org-alias> --refresh
```

To show timing information:

```bash
mf-check check <project-path> --target-org <org-alias> --debug
```

## Example output

```bash
mf-check doctor ./my-salesforce-project
```

```text
Diagnosing project: ./my-salesforce-project
✓ uiBundles directory found
✓ Found UI Bundles: MyBundle

✗ MF-META-008 MyApp: invalid uiType
  Problem:
  The application "MyApp" must use uiType "Lightning", but found "Classic".
  Why it matters:
  A Multi-Framework UI Bundle must be exposed through a Lightning CustomApplication.
  How to fix:
  - Set the CustomApplication uiType to "Lightning" and deploy the corrected application metadata.

○ MF-GRAPHQL-007 Live GraphQL check skipped: no target org provided
  Problem:
  The target org was not provided, so live GraphQL validation was not performed.
  Why it matters:
  Without a target org, mf-check cannot confirm that local GraphQL operations are compatible with the live Salesforce schema.
  How to fix:
  - Provide a target org when you want mf-check to perform live GraphQL schema validation.

NOT READY
```

## Local development

```bash
npm install
npm run build
npm link
```

Run tests with:

```bash
npm run test
```

## Status

Early-stage, but usable. I'm adding checks based on problems I find while
working with Salesforce Multi-Framework.

## License

MIT
