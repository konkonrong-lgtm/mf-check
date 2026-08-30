# mf-check

A small preflight checker for Salesforce Multi-Framework projects.

I built this while experimenting with Multi-Framework React and ran into a few
cases where a deployment succeeded but the app still wasn't ready to use.

For example, a CustomApplication can be deployed with the wrong configuration,
and GraphQL operations that work locally may not match the schema of the org
you're deploying to.

`mf-check` tries to catch those problems before deployment.

## What it checks

Currently:

- Salesforce project discovery from `sfdx-project.json` package directories
- UI Bundle configuration and build output
- CustomApplication → UI Bundle linkage
- whether the CustomApplication is a Lightning app
- application visibility through Permission Sets or Profiles
- `.graphql` operations against the target org's GraphQL schema

Live schema results are cached for 5 minutes because Salesforce introspection
can be slow. Use `--refresh` together with `--target-org` to bypass the cache.

## Installation

Requires Node.js 22 or later.

```bash
npm install -g @konkonrong/mf-check
```

## Usage

For local metadata checks:

```bash
mf-check check <project-path>
```

To also validate GraphQL operations against an org:

```bash
mf-check check <project-path> --target-org <org-alias>
```

To ignore the cached schema:

```bash
mf-check check <project-path> --target-org <org-alias> --refresh
```

To show timing information:

```bash
mf-check check <project-path> --target-org <org-alias> --debug
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

Still early. I'm adding checks based on problems I find while working with
Salesforce Multi-Framework.

## License

MIT
