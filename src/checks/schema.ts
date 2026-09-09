import { findGraphqlFiles, findSourceFiles } from '../utils/files.js';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  getSalesforceSchema,
  type SalesforceSchemaRuntimeInfo,
} from '../salesforce/schema.js';

import {
  buildClientSchema,
  getLocation,
  GraphQLError,
  Kind,
  parse,
  Source,
  validate,
  type DefinitionNode,
  type DocumentNode,
} from 'graphql';
import type { DiagnosticResult } from '../diagnostics/types.js';
import {
  extractInlineGraphqlDocuments,
  type InlineGraphqlDocument,
} from '../utils/inlineGraphql.js';
import { resolveUiBundleOutputPath } from '../utils/uiBundleOutput.js';

export type SchemaCheckRuntimeInfo = SalesforceSchemaRuntimeInfo & {
  schemaProcessingMs?: number;
};

type SchemaCheckResult = {
  diagnostics: DiagnosticResult[];
  runtime?: SchemaCheckRuntimeInfo;
};

function getUiBundleOutputPath(bundlePath: string): string | undefined {
  const configPath = join(bundlePath, 'ui-bundle.json');

  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      outputDir?: unknown;
    };

    if (typeof config.outputDir !== 'string' || !config.outputDir) {
      return undefined;
    }

    return resolveUiBundleOutputPath(bundlePath, config.outputDir);
  } catch {
    // Bundle validation reports invalid descriptors and outputDir paths.
    return undefined;
  }
}

function getInlineSourceLine(
  document: InlineGraphqlDocument,
  graphqlLine: number | undefined
): number | undefined {
  if (!document.hasReliableLineMapping || graphqlLine === undefined) {
    return undefined;
  }

  return document.contentStartLine + graphqlLine - 1;
}

export async function checkSchema(
  projectPath: string,
  uiBundlesPaths: string[],
  apiVersion: string | undefined,
  targetOrg: string,
  refresh = false,
  debug = false
): Promise<SchemaCheckResult> {
  const diagnostics: DiagnosticResult[] = [];

  if (!apiVersion) {
    diagnostics.push({
      id: 'MF-GRAPHQL-001',
      category: 'project',
      status: 'FAIL',
      summary: 'sourceApiVersion not found',
      problem: 'The sfdx-project.json file does not define sourceApiVersion.',
      whyItMatters:
        'mf-check needs sourceApiVersion to request the matching Salesforce GraphQL schema for the target org.',
      remediation: [
        'Define sourceApiVersion in sfdx-project.json, then run mf-check again.',
      ],
      file: join(projectPath, 'sfdx-project.json'),
    });

    return {
      diagnostics,
    };
  }

  let schemaResult: Awaited<ReturnType<typeof getSalesforceSchema>>;

  try {
    schemaResult = await getSalesforceSchema(targetOrg, apiVersion, refresh, debug);
  } catch (error) {
    diagnostics.push({
      id: 'MF-GRAPHQL-006',
      category: 'data',
      status: 'UNKNOWN',
      blocksReadiness: true,
      summary: 'Live GraphQL schema could not be retrieved',
      problem: error instanceof Error ? error.message : String(error),
      whyItMatters:
        'mf-check could not complete live GraphQL compatibility validation against the target org.',
      possibleCauses: [
        'The target org may be unavailable or authentication may have failed.',
        'The Salesforce GraphQL schema could not be retrieved.',
      ],
      remediation: [
        'Confirm that the target org is authenticated and reachable.',
        'Verify the target org selection, then run mf-check again.',
      ],
    });

    return { diagnostics };
  }

  const schemaProcessingStartedAt = debug ? performance.now() : undefined;
  let liveGraphqlSchema: ReturnType<typeof buildClientSchema>;

  try {
    liveGraphqlSchema = buildClientSchema(schemaResult.data as any, {
      assumeValid: true,
    });
  } catch (error) {
    diagnostics.push({
      id: 'MF-GRAPHQL-006',
      category: 'data',
      status: 'UNKNOWN',
      blocksReadiness: true,
      summary: 'Live GraphQL schema could not be processed',
      problem: error instanceof Error ? error.message : String(error),
      whyItMatters:
        'mf-check could not build a usable schema for live GraphQL compatibility validation.',
      remediation: ['Refresh the target org schema and run mf-check again.'],
    });

    return { diagnostics };
  }

  const schemaProcessingMs =
    schemaProcessingStartedAt !== undefined
      ? performance.now() - schemaProcessingStartedAt
      : undefined;

  const runtime: SchemaCheckRuntimeInfo = {
    ...schemaResult.runtime,
    ...(schemaProcessingMs !== undefined ? { schemaProcessingMs } : {}),
  };

  const graphqlBundles: { files: string[]; sourceFiles: string[] }[] = [];
  let inspectionFailureCount = 0;

  for (const uiBundlesPath of uiBundlesPaths) {
    if (!existsSync(uiBundlesPath)) {
      continue;
    }

    let bundleEntries: Dirent[];

    try {
      bundleEntries = readdirSync(uiBundlesPath, { withFileTypes: true });
    } catch (error) {
      inspectionFailureCount += 1;
      diagnostics.push({
        id: 'MF-GRAPHQL-008',
        category: 'data',
        status: 'UNKNOWN',
        blocksReadiness: true,
        summary: 'Local GraphQL scan incomplete',
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot confirm target-org compatibility for GraphQL operations under a uiBundles directory that cannot be enumerated.',
        remediation: [
          'Make sure the uiBundles directory is readable by the current user, then run mf-check again.',
        ],
        file: uiBundlesPath,
      });

      continue;
    }

    for (const entry of bundleEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const bundlePath = join(uiBundlesPath, entry.name);
      const outputPath = getUiBundleOutputPath(bundlePath);
      const excludedPaths = outputPath ? [outputPath] : [];
      let files: string[];

      try {
        files = findGraphqlFiles(bundlePath, excludedPaths);
      } catch (error) {
        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-008',
          category: 'data',
          status: 'UNKNOWN',
          blocksReadiness: true,
          summary: `${entry.name}: local GraphQL scan incomplete`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot confirm target-org compatibility for GraphQL operations in a UI Bundle that cannot be fully enumerated.',
          remediation: [
            'Make sure the UI Bundle source directories are readable, then run mf-check again.',
          ],
          file: bundlePath,
        });

        continue;
      }

      let sourceFiles: string[] = [];

      try {
        sourceFiles = findSourceFiles(join(bundlePath, 'src'), excludedPaths);
      } catch (error) {
        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-009',
          category: 'data',
          status: 'UNKNOWN',
          blocksReadiness: true,
          summary: `${entry.name}: inline GraphQL scan incomplete`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot confirm target-org compatibility for inline GraphQL in a UI Bundle whose source directory cannot be fully enumerated.',
          remediation: [
            'Make sure the UI Bundle source directory is readable, then run mf-check again.',
          ],
          file: join(bundlePath, 'src'),
        });
      }

      graphqlBundles.push({ files, sourceFiles });
    }
  }

  let executableDefinitionCount = 0;
  let inlineTemplateCount = 0;

  for (const bundle of graphqlBundles) {
    const executableDefinitions: DefinitionNode[] = [];
    const executableFiles = new Set<string>();

    for (const filePath of bundle.files) {
      const displayPath = relative(projectPath, filePath);

      let sourceText: string;

      try {
        sourceText = readFileSync(filePath, 'utf-8');
      } catch (error) {
        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-005',
          category: 'data',
          status: 'UNKNOWN',
          blocksReadiness: true,
          summary: `${displayPath}: GraphQL operation could not be read`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot validate this GraphQL operation against the target org schema when the file cannot be read.',
          remediation: [
            'Make sure the GraphQL file is readable by the current user, then run mf-check again.',
          ],
          file: filePath,
        });

        continue;
      }

      let document: DocumentNode;

      try {
        document = parse(new Source(sourceText, filePath));
      } catch (error) {
        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-005',
          category: 'data',
          status: 'FAIL',
          summary: `${displayPath}: invalid GraphQL syntax`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'This GraphQL file cannot be validated against the target org schema until its syntax is valid.',
          remediation: ['Fix the GraphQL syntax in this file, then run mf-check again.'],
          file: filePath,
          ...(error instanceof GraphQLError && error.locations?.[0]
            ? { line: error.locations[0].line }
            : {}),
        });

        continue;
      }

      for (const definition of document.definitions) {
        if (
          definition.kind !== Kind.OPERATION_DEFINITION &&
          definition.kind !== Kind.FRAGMENT_DEFINITION
        ) {
          continue;
        }

        executableDefinitions.push(definition);
        executableFiles.add(filePath);
        executableDefinitionCount += 1;
      }
    }

    if (executableDefinitions.length === 0) {
      continue;
    }

    const executableDocument: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: executableDefinitions,
    };
    const validationErrors = validate(liveGraphqlSchema, executableDocument);

    if (validationErrors.length === 0) {
      for (const filePath of executableFiles) {
        diagnostics.push({
          id: 'MF-GRAPHQL-003',
          category: 'data',
          status: 'PASS',
          summary: `${relative(projectPath, filePath)}: valid against target org schema`,
          file: filePath,
        });
      }

      continue;
    }

    const errorsByFile = new Map<
      string,
      {
        messages: Set<string>;
        line?: number;
      }
    >();

    for (const validationError of validationErrors) {
      const associatedFiles = new Set<string>();

      for (const node of validationError.nodes ?? []) {
        if (!node.loc) {
          continue;
        }

        const filePath = node.loc.source.name;
        associatedFiles.add(filePath);

        const existing = errorsByFile.get(filePath) ?? {
          messages: new Set<string>(),
        };

        existing.messages.add(validationError.message);
        existing.line ??= getLocation(node.loc.source, node.loc.start).line;
        errorsByFile.set(filePath, existing);
      }

      if (associatedFiles.size === 0) {
        const fallbackFile = executableFiles.values().next().value;

        if (fallbackFile) {
          const existing = errorsByFile.get(fallbackFile) ?? {
            messages: new Set<string>(),
          };

          existing.messages.add(validationError.message);
          errorsByFile.set(fallbackFile, existing);
        }
      }
    }

    for (const [filePath, fileErrors] of errorsByFile) {
      diagnostics.push({
        id: 'MF-GRAPHQL-004',
        category: 'data',
        status: 'FAIL',
        summary: `${relative(projectPath, filePath)}: invalid against target org schema`,
        problem: [...fileErrors.messages].join('\n'),
        whyItMatters:
          'This GraphQL operation does not match the schema currently exposed by the selected target org, so it may fail when executed there.',
        possibleCauses: [
          'The referenced field or type may not exist in the target org.',
          'The authenticated user may not have access to the referenced field or type.',
          'The wrong target org may be selected.',
        ],
        remediation: [
          'Review the reported field or type errors and update the GraphQL operation to match the target org schema.',
          'Confirm that the intended target org is selected and that the authenticated user has access to the required schema fields.',
        ],
        file: filePath,
        ...(fileErrors.line !== undefined ? { line: fileErrors.line } : {}),
      });
    }
  }

  for (const bundle of graphqlBundles) {
    for (const filePath of bundle.sourceFiles) {
      let extractionResult: ReturnType<typeof extractInlineGraphqlDocuments>;

      try {
        extractionResult = extractInlineGraphqlDocuments(filePath);
      } catch (error) {
        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-009',
          category: 'data',
          status: 'UNKNOWN',
          blocksReadiness: true,
          summary: `${relative(projectPath, filePath)}: inline GraphQL scan incomplete`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check could not inspect this source file, so it cannot confirm whether all inline GraphQL documents are compatible with the target org.',
          remediation: [
            'Make sure the source file is readable and uses supported JavaScript or TypeScript syntax, then run mf-check again.',
          ],
          file: filePath,
        });
        continue;
      }

      for (const unvalidatedTemplate of extractionResult.unvalidatedTemplates) {
        inlineTemplateCount += 1;
        const displayPath = `${relative(projectPath, filePath)}:${unvalidatedTemplate.line}`;

        if (unvalidatedTemplate.reason === 'dynamic') {
          diagnostics.push({
            id: 'MF-GRAPHQL-010',
            category: 'data',
            status: 'UNKNOWN',
            blocksReadiness: false,
            summary: `${displayPath}: dynamic inline GraphQL not statically validated`,
            problem:
              'This Salesforce SDK gql template contains interpolation, so mf-check did not evaluate or partially validate it.',
            whyItMatters:
              'The template may be valid at runtime, but mf-check cannot confirm its target-org compatibility without evaluating source code.',
            remediation: [
              'Use a static gql template when you want mf-check to validate the complete GraphQL document.',
            ],
            file: filePath,
            line: unvalidatedTemplate.line,
          });
          continue;
        }

        inspectionFailureCount += 1;
        diagnostics.push({
          id: 'MF-GRAPHQL-009',
          category: 'data',
          status: 'UNKNOWN',
          blocksReadiness: true,
          summary: `${displayPath}: inline GraphQL could not be extracted`,
          problem:
            'This Salesforce SDK gql template contains an escape sequence that JavaScript does not expose as a cooked static string.',
          whyItMatters:
            'mf-check cannot parse or validate the runtime GraphQL document represented by this template.',
          remediation: [
            'Use a valid static template string that can be parsed by JavaScript, then run mf-check again.',
          ],
          file: filePath,
          line: unvalidatedTemplate.line,
        });
      }

      for (const inlineDocument of extractionResult.documents) {
        inlineTemplateCount += 1;
        const displayPath = `${relative(projectPath, filePath)}:${inlineDocument.templateLine}`;
        let document: DocumentNode;

        try {
          document = parse(new Source(inlineDocument.sourceText, filePath));
        } catch (error) {
          inspectionFailureCount += 1;
          const graphqlLine =
            error instanceof GraphQLError ? error.locations?.[0]?.line : undefined;
          const sourceLine = getInlineSourceLine(inlineDocument, graphqlLine);

          diagnostics.push({
            id: 'MF-GRAPHQL-005',
            category: 'data',
            status: 'FAIL',
            summary: `${displayPath}: invalid inline GraphQL syntax`,
            problem: error instanceof Error ? error.message : String(error),
            whyItMatters:
              'This inline GraphQL document cannot be validated against the target org schema until its syntax is valid.',
            remediation: [
              'Fix the GraphQL syntax in this gql template, then run mf-check again.',
            ],
            file: filePath,
            ...(sourceLine !== undefined ? { line: sourceLine } : {}),
          });
          continue;
        }

        const executableDefinitions = document.definitions.filter(
          (definition) =>
            definition.kind === Kind.OPERATION_DEFINITION ||
            definition.kind === Kind.FRAGMENT_DEFINITION
        );

        if (executableDefinitions.length === 0) {
          continue;
        }

        executableDefinitionCount += executableDefinitions.length;

        const executableDocument: DocumentNode = {
          kind: Kind.DOCUMENT,
          definitions: executableDefinitions,
        };
        const validationErrors = validate(liveGraphqlSchema, executableDocument);

        if (validationErrors.length === 0) {
          diagnostics.push({
            id: 'MF-GRAPHQL-003',
            category: 'data',
            status: 'PASS',
            summary: `${displayPath}: inline GraphQL valid against target org schema`,
            file: filePath,
            line: inlineDocument.templateLine,
          });
          continue;
        }

        const messages = new Set<string>();
        let sourceLine: number | undefined;

        for (const validationError of validationErrors) {
          messages.add(validationError.message);

          for (const node of validationError.nodes ?? []) {
            if (!node.loc) {
              continue;
            }

            const graphqlLine = getLocation(node.loc.source, node.loc.start).line;
            sourceLine ??= getInlineSourceLine(inlineDocument, graphqlLine);
          }
        }

        diagnostics.push({
          id: 'MF-GRAPHQL-004',
          category: 'data',
          status: 'FAIL',
          summary: `${displayPath}: inline GraphQL invalid against target org schema`,
          problem: [...messages].join('\n'),
          whyItMatters:
            'This inline GraphQL document does not match the schema currently exposed by the selected target org, so it may fail when executed there.',
          possibleCauses: [
            'The referenced field or type may not exist in the target org.',
            'The authenticated user may not have access to the referenced field or type.',
            'The wrong target org may be selected.',
          ],
          remediation: [
            'Review the reported field or type errors and update the gql template to match the target org schema.',
            'Confirm that the intended target org is selected and that the authenticated user has access to the required schema fields.',
          ],
          file: filePath,
          ...(sourceLine !== undefined ? { line: sourceLine } : {}),
        });
      }
    }
  }

  if (
    executableDefinitionCount === 0 &&
    inlineTemplateCount === 0 &&
    inspectionFailureCount === 0
  ) {
    diagnostics.push({
      id: 'MF-GRAPHQL-002',
      category: 'data',
      status: 'PASS',
      summary: 'No .graphql operations found',
    });
  }

  return {
    diagnostics,
    runtime,
  };
}
