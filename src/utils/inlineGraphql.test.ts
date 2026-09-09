import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractInlineGraphqlDocuments } from './inlineGraphql.js';

describe('extractInlineGraphqlDocuments', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mf-check-inline-graphql-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['js', '@salesforce/platform-sdk/data', 'gql', ''],
    ['jsx', '@salesforce/platform-sdk', 'gql', 'const element = <div />;'],
    ['ts', '@salesforce/platform-sdk/data', 'sfGql', 'type Result = string;'],
    ['tsx', '@salesforce/platform-sdk', 'sfGql', 'const element = <div />;'],
  ])(
    'extracts a static Salesforce gql document from .%s source',
    (extension, moduleName, localName, extraSource) => {
      const filePath = join(directory, `accounts.${extension}`);
      const importSpecifier = localName === 'gql' ? 'gql' : `gql as ${localName}`;

      writeFileSync(
        filePath,
        [
          `import { ${importSpecifier} } from '${moduleName}';`,
          extraSource,
          `const query = ${localName}\`query Accounts { Account { edges { node { Id } } } }\`;`,
        ].join('\n')
      );

      const result = extractInlineGraphqlDocuments(filePath);

      expect(result.documents).toEqual([
        expect.objectContaining({
          sourceText: 'query Accounts { Account { edges { node { Id } } } }',
          templateLine: 3,
        }),
      ]);
      expect(result.unvalidatedTemplates).toEqual([]);
    }
  );

  it('uses lexical bindings to distinguish imported gql names from shadowed names', () => {
    const filePath = join(directory, 'accounts.ts');

    writeFileSync(
      filePath,
      [
        "import { gql, gql as sfGql } from '@salesforce/platform-sdk/data';",
        'const valid = gql`query Valid { Account { edges { node { Id } } } }`;',
        'function shadowDirect(gql: (strings: TemplateStringsArray) => string) {',
        '  return gql`query ShadowedDirect { Missing }`;',
        '}',
        'function shadowAlias() {',
        '  const sfGql = String.raw;',
        '  return sfGql`query ShadowedAlias { Missing }`;',
        '}',
      ].join('\n')
    );

    const result = extractInlineGraphqlDocuments(filePath);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.sourceText).toContain('query Valid');
  });

  it.each(['ts', 'tsx'])(
    'extracts static Salesforce gql from decorated .%s source',
    (extension) => {
      const filePath = join(directory, `decorated.${extension}`);

      writeFileSync(
        filePath,
        [
          "import { gql } from '@salesforce/platform-sdk/data';",
          "import { Component } from '@angular/core';",
          "@Component({ selector: 'accounts-view', template: '' })",
          'class AccountsComponent {',
          '  query = gql`query Accounts { Account { edges { node { Id } } } }`;',
          '}',
        ].join('\n')
      );

      const result = extractInlineGraphqlDocuments(filePath);

      expect(result.documents).toEqual([
        expect.objectContaining({
          sourceText: 'query Accounts { Account { edges { node { Id } } } }',
          templateLine: 5,
        }),
      ]);
      expect(result.unvalidatedTemplates).toEqual([]);
    }
  );

  it.each([
    [
      'default import',
      "import gql from '@salesforce/platform-sdk/data';\nconst query = gql`query Ignored { Missing }`;",
    ],
    [
      'another library',
      "import { gql } from 'graphql-tag';\nconst query = gql`query Ignored { Missing }`;",
    ],
    [
      'ordinary function',
      'const gql = String.raw;\nconst query = gql`query Ignored { Missing }`;',
    ],
    [
      'comments and strings',
      [
        "// import { gql } from '@salesforce/platform-sdk/data';",
        'const text = "gql`query Ignored { Missing }`";',
        'const template = `query Ignored { Missing }`;',
      ].join('\n'),
    ],
    [
      'type-only import',
      "import type { gql } from '@salesforce/platform-sdk/data';\nconst text = `query Ignored { Missing }`;",
    ],
  ])('does not treat %s as Salesforce inline GraphQL', (_case, source) => {
    const filePath = join(directory, 'ignored.ts');
    writeFileSync(filePath, source);

    expect(extractInlineGraphqlDocuments(filePath)).toEqual({
      documents: [],
      unvalidatedTemplates: [],
    });
  });

  it('reports an interpolated Salesforce gql template without extracting it', () => {
    const filePath = join(directory, 'dynamic.ts');

    writeFileSync(
      filePath,
      [
        "import { gql } from '@salesforce/platform-sdk/data';",
        "const fields = 'Id';",
        'const query = gql`query Accounts { Account { edges { node { ${fields} } } } }`;',
      ].join('\n')
    );

    const result = extractInlineGraphqlDocuments(filePath);

    expect(result.documents).toEqual([]);
    expect(result.unvalidatedTemplates).toEqual([
      {
        line: 3,
        reason: 'dynamic',
      },
    ]);
  });
});
