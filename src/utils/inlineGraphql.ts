import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createRequire } from 'node:module';

import { parse, type ParserPlugin } from '@babel/parser';
import type { Binding } from '@babel/traverse';

const traverse: typeof import('@babel/traverse').default = createRequire(import.meta.url)(
  '@babel/traverse'
).default;

const salesforceGqlModules = new Set([
  '@salesforce/platform-sdk',
  '@salesforce/platform-sdk/data',
]);

export type InlineGraphqlDocument = {
  sourceText: string;
  templateLine: number;
  contentStartLine: number;
  hasReliableLineMapping: boolean;
};

export type UnvalidatedInlineGraphqlTemplate = {
  line: number;
  reason: 'dynamic' | 'invalid-escape';
};

export type InlineGraphqlExtractionResult = {
  documents: InlineGraphqlDocument[];
  unvalidatedTemplates: UnvalidatedInlineGraphqlTemplate[];
};

function isSalesforceGqlBinding(binding: Binding | undefined): boolean {
  if (!binding?.path.isImportSpecifier()) {
    return false;
  }

  const imported = binding.path.node.imported;
  const importedName = imported.type === 'Identifier' ? imported.name : imported.value;
  const importDeclaration = binding.path.parentPath;

  return (
    importedName === 'gql' &&
    binding.path.node.importKind !== 'type' &&
    importDeclaration?.isImportDeclaration() === true &&
    importDeclaration.node.importKind !== 'type' &&
    salesforceGqlModules.has(importDeclaration.node.source.value)
  );
}

export function extractInlineGraphqlDocuments(
  filePath: string
): InlineGraphqlExtractionResult {
  const sourceText = readFileSync(filePath, 'utf-8');

  if (![...salesforceGqlModules].some((moduleName) => sourceText.includes(moduleName))) {
    return {
      documents: [],
      unvalidatedTemplates: [],
    };
  }

  const extension = extname(filePath).toLowerCase();
  const plugins: ParserPlugin[] =
    extension === '.ts'
      ? ['typescript', 'decorators']
      : extension === '.tsx'
        ? ['typescript', 'jsx', 'decorators']
        : ['jsx'];
  const ast = parse(sourceText, {
    sourceType: 'unambiguous',
    plugins,
  });
  const documents: InlineGraphqlDocument[] = [];
  const unvalidatedTemplates: UnvalidatedInlineGraphqlTemplate[] = [];

  traverse(ast, {
    TaggedTemplateExpression(path) {
      if (path.node.tag.type !== 'Identifier') {
        return;
      }

      const binding = path.scope.getBinding(path.node.tag.name);

      if (!isSalesforceGqlBinding(binding)) {
        return;
      }

      const templateLine = path.node.loc?.start.line ?? 1;

      if (path.node.quasi.expressions.length > 0) {
        unvalidatedTemplates.push({
          line: templateLine,
          reason: 'dynamic',
        });
        return;
      }

      const templateElement = path.node.quasi.quasis[0];
      const cooked = templateElement?.value.cooked;

      if (!templateElement || cooked === null || cooked === undefined) {
        unvalidatedTemplates.push({
          line: templateLine,
          reason: 'invalid-escape',
        });
        return;
      }

      documents.push({
        sourceText: cooked,
        templateLine,
        contentStartLine: templateElement.loc?.start.line ?? templateLine,
        hasReliableLineMapping: templateElement.value.raw === cooked,
      });
    },
  });

  return {
    documents,
    unvalidatedTemplates,
  };
}
