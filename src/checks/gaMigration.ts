import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';
import { createRequire } from 'node:module';

import type { Binding } from '@babel/traverse';
import type { Expression, File } from '@babel/types';
import { findSourceFiles } from '../utils/files.js';

import { resolveUiBundleOutputPath } from '../utils/uiBundleOutput.js';
import type { DiagnosticResult } from '../diagnostics/types.js';

const traverse: typeof import('@babel/traverse').default = createRequire(import.meta.url)(
  '@babel/traverse'
).default;

type GaMigrationCheckResult = {
  diagnostics: DiagnosticResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSourceFile(filePath: string) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const extension = extname(filePath).toLowerCase();

  const plugins: ParserPlugin[] =
    extension === '.ts'
      ? ['typescript']
      : extension === '.tsx'
        ? ['typescript', 'jsx']
        : ['jsx'];

  return parse(sourceText, {
    sourceType: 'unambiguous',
    plugins,
  });
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;

  while (
    current.type === 'AwaitExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression'
  ) {
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  }

  return current;
}

function findLegacyGraphqlCallLine(ast: File): number | undefined {
  const sdkBindings = new Set<Binding>();

  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type !== 'Identifier' || !path.node.init) {
        return;
      }

      const init = unwrapExpression(path.node.init);

      if (init.type !== 'CallExpression') {
        return;
      }

      const callee = init.callee;
      let isSalesforceFactoryCall = false;

      if (callee.type === 'Identifier') {
        const factoryBinding = path.scope.getBinding(callee.name);

        if (factoryBinding?.path.isImportSpecifier()) {
          const imported = factoryBinding.path.node.imported;
          const importedName =
            imported.type === 'Identifier' ? imported.name : imported.value;

          const importDeclaration = factoryBinding.path.parentPath;

          if (
            importedName === 'createDataSDK' &&
            importDeclaration?.isImportDeclaration() &&
            importDeclaration.node.source.value === '@salesforce/sdk-data'
          ) {
            isSalesforceFactoryCall = true;
          }
        } else if (
          factoryBinding?.constant &&
          factoryBinding.path.isVariableDeclarator()
        ) {
          const declarator = factoryBinding.path.node;

          if (
            declarator.id.type === 'ObjectPattern' &&
            declarator.init?.type === 'CallExpression' &&
            declarator.init.callee.type === 'Identifier' &&
            declarator.init.callee.name === 'require' &&
            !factoryBinding.path.scope.getBinding('require') &&
            declarator.init.arguments.length === 1
          ) {
            const moduleName = declarator.init.arguments[0];

            if (
              moduleName?.type === 'StringLiteral' &&
              moduleName.value === '@salesforce/sdk-data'
            ) {
              const factoryProperty = declarator.id.properties.find(
                (property) =>
                  property.type === 'ObjectProperty' &&
                  property.value.type === 'Identifier' &&
                  property.value.name === callee.name &&
                  ((property.key.type === 'Identifier' &&
                    property.key.name === 'createDataSDK') ||
                    (property.key.type === 'StringLiteral' &&
                      property.key.value === 'createDataSDK'))
              );

              if (factoryProperty) {
                isSalesforceFactoryCall = true;
              }
            }
          }
        }
      } else if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'createDataSDK'
      ) {
        const namespaceBinding = path.scope.getBinding(callee.object.name);

        if (namespaceBinding?.path.isImportNamespaceSpecifier()) {
          const importDeclaration = namespaceBinding.path.parentPath;

          if (
            importDeclaration?.isImportDeclaration() &&
            importDeclaration.node.source.value === '@salesforce/sdk-data'
          ) {
            isSalesforceFactoryCall = true;
          }
        }
      }

      if (!isSalesforceFactoryCall) {
        return;
      }

      const sdkBinding = path.scope.getBinding(path.node.id.name);

      if (sdkBinding?.constant) {
        sdkBindings.add(sdkBinding);
      }
    },
  });

  let legacyGraphqlCallLine: number | undefined;

  traverse(ast, {
    'CallExpression|OptionalCallExpression'(path) {
      if (!path.isCallExpression() && !path.isOptionalCallExpression()) {
        return;
      }
      const callee = path.node.callee;

      if (
        callee.type !== 'MemberExpression' &&
        callee.type !== 'OptionalMemberExpression'
      ) {
        return;
      }

      const isGraphqlProperty =
        (!callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'graphql') ||
        (callee.computed &&
          callee.property.type === 'StringLiteral' &&
          callee.property.value === 'graphql');

      if (callee.object.type !== 'Identifier' || !isGraphqlProperty) {
        return;
      }

      const sdkBinding = path.scope.getBinding(callee.object.name);

      if (!sdkBinding || !sdkBindings.has(sdkBinding)) {
        return;
      }

      legacyGraphqlCallLine = path.node.loc?.start.line;
      path.stop();
    },
  });

  return legacyGraphqlCallLine;
}

export function checkGaMigration(
  projectPath: string,
  uiBundlesPaths: string[]
): GaMigrationCheckResult {
  const diagnostics: DiagnosticResult[] = [];
  const scratchDefPath = join(projectPath, 'config', 'project-scratch-def.json');

  if (existsSync(scratchDefPath)) {
    let scratchDef: unknown;

    try {
      const scratchDefText = readFileSync(scratchDefPath, 'utf-8');
      scratchDef = JSON.parse(scratchDefText.replace(/^\uFEFF/, ''));
    } catch {
      diagnostics.push({
        id: 'MF-MIGRATION-005',
        category: 'migration',
        status: 'UNKNOWN',
        blocksReadiness: false,
        summary: 'project-scratch-def.json could not be inspected',
        problem:
          'mf-check could not read or parse project-scratch-def.json, so the UIBundleSettings migration check was not completed.',
        whyItMatters:
          'The absence of MF-MIGRATION-002 does not confirm that the deprecated UIBundleSettings scratch configuration is absent.',
        remediation: [
          'Make sure config/project-scratch-def.json is readable and contains valid JSON, then run mf-check again.',
        ],
        file: scratchDefPath,
      });

      scratchDef = undefined;
    }

    if (scratchDef !== undefined && !isRecord(scratchDef)) {
      diagnostics.push({
        id: 'MF-MIGRATION-005',
        category: 'migration',
        status: 'UNKNOWN',
        blocksReadiness: false,
        summary: 'project-scratch-def.json could not be inspected',
        problem:
          'project-scratch-def.json does not contain a JSON object, so the UIBundleSettings migration check was not completed.',
        whyItMatters:
          'The absence of MF-MIGRATION-002 does not confirm that the deprecated UIBundleSettings scratch configuration is absent.',
        remediation: [
          'Make sure config/project-scratch-def.json contains a valid JSON object, then run mf-check again.',
        ],
        file: scratchDefPath,
      });
    }

    if (isRecord(scratchDef)) {
      const settings = scratchDef.settings;

      if (isRecord(settings)) {
        if (Object.hasOwn(settings, 'UIBundleSettings')) {
          diagnostics.push({
            id: 'MF-MIGRATION-002',
            category: 'migration',
            status: 'FAIL',
            summary: 'Deprecated UIBundleSettings scratch configuration detected',
            problem:
              'The project scratch definition still contains the Beta-era UIBundleSettings configuration.',
            whyItMatters:
              'Salesforce Multi-Framework GA no longer requires the UIBundleSettings scratch configuration.',
            remediation: [
              'Remove UIBundleSettings from settings in config/project-scratch-def.json.',
            ],
            file: scratchDefPath,
            docsUrl:
              'https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga',
          });
        }
      }
    }
  }

  for (const uiBundlesPath of uiBundlesPaths) {
    if (!existsSync(uiBundlesPath)) {
      continue;
    }

    let bundleDirectories: Dirent[];

    try {
      bundleDirectories = readdirSync(uiBundlesPath, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      diagnostics.push({
        id: 'MF-MIGRATION-008',
        category: 'migration',
        status: 'UNKNOWN',
        blocksReadiness: false,
        summary: 'UI Bundle migration scan incomplete',
        problem: `mf-check could not enumerate this uiBundles directory: ${error instanceof Error ? error.message : String(error)}`,
        whyItMatters:
          'The absence of GA migration diagnostics does not confirm that UI Bundles under this path are free of migration residue.',
        remediation: [
          'Make sure the uiBundles directory is readable by the current user, then run mf-check again.',
        ],
        file: uiBundlesPath,
      });

      continue;
    }

    for (const bundleDirectory of bundleDirectories) {
      const bundlePath = join(uiBundlesPath, bundleDirectory.name);
      const sourcePath = join(bundlePath, 'src');
      const excludedSourcePaths: string[] = [];
      let canInspectSource = true;

      const uiBundleJsonPath = join(bundlePath, 'ui-bundle.json');

      if (existsSync(uiBundleJsonPath)) {
        try {
          const uiBundleJsonText = readFileSync(uiBundleJsonPath, 'utf-8');
          const uiBundleJson: unknown = JSON.parse(
            uiBundleJsonText.replace(/^\uFEFF/, '')
          );

          if (
            !isRecord(uiBundleJson) ||
            typeof uiBundleJson.outputDir !== 'string' ||
            !uiBundleJson.outputDir
          ) {
            canInspectSource = false;

            diagnostics.push({
              id: 'MF-MIGRATION-006',
              category: 'migration',
              status: 'UNKNOWN',
              blocksReadiness: false,
              summary: `${bundleDirectory.name}: ui-bundle.json could not be inspected`,
              problem:
                'mf-check could not determine a valid outputDir from ui-bundle.json, so the legacy Data SDK source migration check was not completed.',
              whyItMatters:
                'Without a reliable outputDir, mf-check cannot safely distinguish source files from generated build output.',
              remediation: [
                'Make sure ui-bundle.json defines a valid outputDir, then run mf-check again.',
              ],
              file: uiBundleJsonPath,
            });
          } else {
            const outputPath = resolveUiBundleOutputPath(
              bundlePath,
              uiBundleJson.outputDir
            );

            const relativeToSource = relative(sourcePath, outputPath);

            if (relativeToSource === '') {
              canInspectSource = false;

              diagnostics.push({
                id: 'MF-MIGRATION-007',
                category: 'migration',
                status: 'UNKNOWN',
                blocksReadiness: false,
                summary: `${bundleDirectory.name}: source migration scan incomplete`,
                problem:
                  'The configured outputDir resolves to the UI Bundle source root, so mf-check cannot distinguish source files from generated build output.',
                whyItMatters:
                  'The absence of MF-MIGRATION-003 does not confirm that the UI Bundle has migrated away from the Beta Data SDK graphql() API.',
                remediation: [
                  'Use a separate outputDir for generated build output if you want mf-check to perform the source migration scan, then run mf-check again.',
                ],
                file: uiBundleJsonPath,
              });
            } else if (
              relativeToSource !== '' &&
              relativeToSource !== '..' &&
              !relativeToSource.startsWith(`..${sep}`) &&
              !isAbsolute(relativeToSource)
            ) {
              excludedSourcePaths.push(outputPath);
            }
          }
        } catch {
          canInspectSource = false;

          diagnostics.push({
            id: 'MF-MIGRATION-006',
            category: 'migration',
            status: 'UNKNOWN',
            blocksReadiness: false,
            summary: `${bundleDirectory.name}: ui-bundle.json could not be inspected`,
            problem:
              'mf-check could not safely inspect ui-bundle.json, so the legacy Data SDK source migration check was not completed.',
            whyItMatters:
              'Without a reliable outputDir, mf-check cannot safely distinguish source files from generated build output.',
            remediation: [
              'Make sure ui-bundle.json is readable, contains valid JSON, and has a valid outputDir, then run mf-check again.',
            ],
            file: uiBundleJsonPath,
          });
        }
      }

      let sourceFiles: string[] = [];

      if (canInspectSource) {
        try {
          sourceFiles = findSourceFiles(sourcePath, excludedSourcePaths);
        } catch {
          diagnostics.push({
            id: 'MF-MIGRATION-007',
            category: 'migration',
            status: 'UNKNOWN',
            blocksReadiness: false,
            summary: `${bundleDirectory.name}: source migration scan incomplete`,
            problem:
              'mf-check could not enumerate the UI Bundle source directory, so the legacy Data SDK graphql() migration check was not completed.',
            whyItMatters:
              'The absence of MF-MIGRATION-003 does not confirm that the UI Bundle has migrated away from the Beta Data SDK graphql() API.',
            remediation: [
              'Make sure the UI Bundle source directories are readable, then run mf-check again.',
            ],
            file: sourcePath,
          });
        }
      }

      let firstUninspectedSourceFile: string | undefined;

      for (const sourceFile of sourceFiles) {
        try {
          const ast = parseSourceFile(sourceFile);
          const line = findLegacyGraphqlCallLine(ast);

          if (line === undefined) {
            continue;
          }

          diagnostics.push({
            id: 'MF-MIGRATION-003',
            category: 'migration',
            status: 'FAIL',
            summary: `${bundleDirectory.name}: Beta Data SDK graphql() API detected`,
            problem: 'This UI Bundle still calls the Beta-era Data SDK graphql() API.',
            whyItMatters:
              'Salesforce Multi-Framework GA replaces the single graphql() API with query() and mutate().',
            remediation: [
              'Replace the legacy graphql() call with query() for GraphQL queries.',
              'Use mutate() for GraphQL mutations.',
            ],
            file: sourceFile,
            line,
            docsUrl:
              'https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga',
          });
        } catch {
          firstUninspectedSourceFile ??= sourceFile;
          continue;
        }
      }

      if (firstUninspectedSourceFile) {
        diagnostics.push({
          id: 'MF-MIGRATION-007',
          category: 'migration',
          status: 'UNKNOWN',
          blocksReadiness: false,
          summary: `${bundleDirectory.name}: source migration scan incomplete`,
          problem:
            'mf-check could not inspect at least one source file, so the legacy Data SDK graphql() migration check was not completed for the entire UI Bundle.',
          whyItMatters:
            'The absence of MF-MIGRATION-003 does not confirm that every source file has migrated away from the Beta Data SDK graphql() API.',
          remediation: [
            'Make sure the source file is readable and uses supported JavaScript or TypeScript syntax, then run mf-check again.',
          ],
          file: firstUninspectedSourceFile,
        });
      }

      const packageJsonPath = join(bundlePath, 'package.json');

      if (!existsSync(packageJsonPath)) {
        continue;
      }

      let packageJson: unknown;

      try {
        const packageJsonText = readFileSync(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(packageJsonText.replace(/^\uFEFF/, ''));
      } catch {
        diagnostics.push({
          id: 'MF-MIGRATION-004',
          category: 'migration',
          status: 'UNKNOWN',
          blocksReadiness: false,
          summary: `${bundleDirectory.name}: package.json could not be inspected`,
          problem:
            'mf-check could not read or parse this package.json, so the @salesforce/sdk-data migration check was not completed.',
          whyItMatters:
            'The absence of MF-MIGRATION-001 does not confirm that this UI Bundle has migrated away from @salesforce/sdk-data.',
          remediation: [
            'Make sure package.json is readable and contains valid JSON, then run mf-check again.',
          ],
          file: packageJsonPath,
        });

        continue;
      }

      if (!isRecord(packageJson)) {
        diagnostics.push({
          id: 'MF-MIGRATION-004',
          category: 'migration',
          status: 'UNKNOWN',
          blocksReadiness: false,
          summary: `${bundleDirectory.name}: package.json could not be inspected`,
          problem:
            'package.json does not contain a JSON object, so the @salesforce/sdk-data migration check was not completed.',
          whyItMatters:
            'The absence of MF-MIGRATION-001 does not confirm that this UI Bundle has migrated away from @salesforce/sdk-data.',
          remediation: [
            'Make sure package.json contains a valid JSON object, then run mf-check again.',
          ],
          file: packageJsonPath,
        });

        continue;
      }

      const dependencies = packageJson.dependencies;

      if (!isRecord(dependencies)) {
        continue;
      }
      if (Object.hasOwn(dependencies, '@salesforce/sdk-data')) {
        diagnostics.push({
          id: 'MF-MIGRATION-001',
          category: 'migration',
          status: 'FAIL',
          summary: `${bundleDirectory.name}: deprecated @salesforce/sdk-data dependency`,
          problem:
            'This UI Bundle still depends on the Beta-era @salesforce/sdk-data package.',
          whyItMatters:
            'Salesforce Multi-Framework GA uses @salesforce/platform-sdk instead of @salesforce/sdk-data.',
          remediation: [
            'Replace @salesforce/sdk-data with @salesforce/platform-sdk.',
            'Update Data SDK imports to use @salesforce/platform-sdk/data.',
          ],
          file: packageJsonPath,
          docsUrl:
            'https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga',
        });
      }
    }
  }

  return {
    diagnostics,
  };
}
