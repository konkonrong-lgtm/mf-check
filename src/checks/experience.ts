import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { DiagnosticResult } from '../diagnostics/types.js';
import type { BundleInfo } from './bundle.js';

type ExperienceCheckResult = {
  diagnostics: DiagnosticResult[];
};

type UnknownResult = {
  kind: 'unknown';
  problem: string;
  file: string;
};

type LookupResult<T> =
  | {
      kind: 'found';
      value: T;
      file: string;
    }
  | {
      kind: 'missing';
    }
  | UnknownResult;

type ExperienceContainerCandidate = {
  siteSpace: string;
  siteSpacePath: string;
  cmsRecordPath: string;
  contentPath: string;
  content: Record<string, unknown>;
};

type ContainerScanResult = {
  candidates: ExperienceContainerCandidate[];
  firstUnknown?: UnknownResult;
  invalidContainer?: {
    file: string;
  };
};

type ChainEvaluation =
  | {
      kind: 'pass';
      file: string;
    }
  | {
      kind: 'fail';
      problem: string;
      file?: string;
    }
  | UnknownResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): LookupResult<Record<string, unknown>> {
  let text: string;

  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (error) {
    return {
      kind: 'unknown',
      problem: error instanceof Error ? error.message : String(error),
      file: filePath,
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      kind: 'unknown',
      problem:
        error instanceof Error ? error.message : `Could not parse JSON in ${filePath}.`,
      file: filePath,
    };
  }

  if (!isRecord(parsed)) {
    return {
      kind: 'unknown',
      problem: 'The JSON metadata root must be an object.',
      file: filePath,
    };
  }

  return {
    kind: 'found',
    value: parsed,
    file: filePath,
  };
}

function readXmlRoot(
  filePath: string,
  expectedRoot: string,
  parser: XMLParser
): LookupResult<Record<string, unknown>> {
  let xml: string;

  try {
    xml = readFileSync(filePath, 'utf-8');
  } catch (error) {
    return {
      kind: 'unknown',
      problem: error instanceof Error ? error.message : String(error),
      file: filePath,
    };
  }

  const validationResult = XMLValidator.validate(xml);

  if (validationResult !== true) {
    return {
      kind: 'unknown',
      problem: validationResult.err.msg,
      file: filePath,
    };
  }

  let parsed: unknown;

  try {
    parsed = parser.parse(xml);
  } catch (error) {
    return {
      kind: 'unknown',
      problem: error instanceof Error ? error.message : String(error),
      file: filePath,
    };
  }

  if (
    !isRecord(parsed) ||
    !Object.hasOwn(parsed, expectedRoot) ||
    !isRecord(parsed[expectedRoot])
  ) {
    return {
      kind: 'unknown',
      problem: `The metadata XML root element must be ${expectedRoot}.`,
      file: filePath,
    };
  }

  return {
    kind: 'found',
    value: parsed[expectedRoot],
    file: filePath,
  };
}

function findXmlMetadata(
  metadataRoots: string[],
  directoryName: string,
  fileSuffix: string,
  expectedRoot: string,
  parser: XMLParser,
  matches: (metadata: Record<string, unknown>, fileName: string) => boolean
): LookupResult<Record<string, unknown>> {
  let firstUnknown: UnknownResult | undefined;

  for (const metadataRoot of metadataRoots) {
    const directoryPath = join(metadataRoot, directoryName);

    if (!existsSync(directoryPath)) {
      continue;
    }

    let files: string[];

    try {
      files = readdirSync(directoryPath).filter((file) => file.endsWith(fileSuffix));
    } catch (error) {
      if (!firstUnknown) {
        firstUnknown = {
          kind: 'unknown',
          problem: error instanceof Error ? error.message : String(error),
          file: directoryPath,
        };
      }

      continue;
    }

    for (const file of files) {
      const filePath = join(directoryPath, file);
      const metadata = readXmlRoot(filePath, expectedRoot, parser);

      if (metadata.kind === 'unknown') {
        firstUnknown ??= metadata;
        continue;
      }

      if (metadata.kind === 'missing') {
        continue;
      }

      if (matches(metadata.value, file)) {
        return metadata;
      }
    }
  }

  if (firstUnknown) {
    return firstUnknown;
  }

  return {
    kind: 'missing',
  };
}

function scanExperienceContainers(
  metadataRoots: string[],
  expectedAppSpace: string
): ContainerScanResult {
  const candidates: ExperienceContainerCandidate[] = [];
  let firstUnknown: UnknownResult | undefined;
  let invalidContainer: { file: string } | undefined;

  for (const metadataRoot of metadataRoots) {
    const siteRootPath = join(metadataRoot, 'digitalExperiences', 'site');

    if (!existsSync(siteRootPath)) {
      continue;
    }

    let siteEntries;

    try {
      siteEntries = readdirSync(siteRootPath, {
        withFileTypes: true,
      });
    } catch (error) {
      firstUnknown ??= {
        kind: 'unknown',
        problem: error instanceof Error ? error.message : String(error),
        file: siteRootPath,
      };

      continue;
    }

    for (const siteEntry of siteEntries) {
      if (!siteEntry.isDirectory()) {
        continue;
      }

      const siteSpace = siteEntry.name;
      const siteSpacePath = join(siteRootPath, siteSpace);
      const cmsSiteRoot = join(siteSpacePath, 'sfdc_cms__site');

      if (!existsSync(cmsSiteRoot)) {
        continue;
      }

      let cmsEntries;

      try {
        cmsEntries = readdirSync(cmsSiteRoot, {
          withFileTypes: true,
        });
      } catch (error) {
        firstUnknown ??= {
          kind: 'unknown',
          problem: error instanceof Error ? error.message : String(error),
          file: cmsSiteRoot,
        };

        continue;
      }

      for (const cmsEntry of cmsEntries) {
        if (!cmsEntry.isDirectory()) {
          continue;
        }

        const cmsRecordPath = join(cmsSiteRoot, cmsEntry.name);
        const contentPath = join(cmsRecordPath, 'content.json');

        if (!existsSync(contentPath)) {
          continue;
        }

        const contentResult = readJsonObject(contentPath);

        if (contentResult.kind === 'unknown') {
          firstUnknown ??= contentResult;
          continue;
        }

        if (contentResult.kind === 'missing') {
          continue;
        }

        const contentBody = contentResult.value.contentBody;

        if (!isRecord(contentBody)) {
          continue;
        }

        if (contentBody.appSpace !== expectedAppSpace) {
          continue;
        }

        if (contentBody.appContainer !== true) {
          invalidContainer ??= {
            file: contentPath,
          };

          continue;
        }

        candidates.push({
          siteSpace,
          siteSpacePath,
          cmsRecordPath,
          contentPath,
          content: contentResult.value,
        });
      }
    }
  }

  const result: ContainerScanResult = {
    candidates,
  };

  if (firstUnknown) {
    result.firstUnknown = firstUnknown;
  }

  if (invalidContainer) {
    result.invalidContainer = invalidContainer;
  }

  return result;
}

function findCustomSite(
  metadataRoots: string[],
  siteName: string,
  parser: XMLParser
): LookupResult<Record<string, unknown>> {
  const expectedFileName = `${siteName}.site-meta.xml`;
  let firstUnknown: UnknownResult | undefined;

  for (const metadataRoot of metadataRoots) {
    const sitesPath = join(metadataRoot, 'sites');

    if (!existsSync(sitesPath)) {
      continue;
    }

    let files: string[];

    try {
      files = readdirSync(sitesPath);
    } catch (error) {
      firstUnknown ??= {
        kind: 'unknown',
        problem: error instanceof Error ? error.message : String(error),
        file: sitesPath,
      };

      continue;
    }

    if (!files.includes(expectedFileName)) {
      continue;
    }

    const filePath = join(sitesPath, expectedFileName);
    const result = readXmlRoot(filePath, 'CustomSite', parser);

    if (result.kind === 'found') {
      return result;
    }

    if (result.kind === 'unknown') {
      firstUnknown ??= result;
    }
  }

  if (firstUnknown) {
    return firstUnknown;
  }

  return {
    kind: 'missing',
  };
}

function evaluateCandidate(
  metadataRoots: string[],
  candidate: ExperienceContainerCandidate,
  parser: XMLParser
): ChainEvaluation {
  if (candidate.content.type !== 'sfdc_cms__site') {
    return {
      kind: 'fail',
      problem:
        'The matching Digital Experience content record is not of type "sfdc_cms__site".',
      file: candidate.contentPath,
    };
  }

  const bundleMetadataPath = join(
    candidate.siteSpacePath,
    `${candidate.siteSpace}.digitalExperience-meta.xml`
  );

  if (!existsSync(bundleMetadataPath)) {
    return {
      kind: 'fail',
      problem: `The Digital Experience site space "${candidate.siteSpace}" does not contain its DigitalExperienceBundle metadata file.`,
      file: candidate.siteSpacePath,
    };
  }

  const bundleMetadata = readXmlRoot(
    bundleMetadataPath,
    'DigitalExperienceBundle',
    parser
  );

  if (bundleMetadata.kind === 'unknown') {
    return bundleMetadata;
  }

  const cmsMetaPath = join(candidate.cmsRecordPath, '_meta.json');

  if (!existsSync(cmsMetaPath)) {
    return {
      kind: 'fail',
      problem: 'The matching sfdc_cms__site record does not contain _meta.json.',
      file: candidate.cmsRecordPath,
    };
  }

  const cmsMeta = readJsonObject(cmsMetaPath);

  if (cmsMeta.kind === 'unknown') {
    return cmsMeta;
  }

  if (cmsMeta.kind === 'missing') {
    return {
      kind: 'fail',
      problem: 'The matching sfdc_cms__site record does not contain readable metadata.',
      file: cmsMetaPath,
    };
  }

  if (cmsMeta.value.type !== 'sfdc_cms__site') {
    return {
      kind: 'fail',
      problem: 'The matching _meta.json does not identify an sfdc_cms__site record.',
      file: cmsMetaPath,
    };
  }

  if (cmsMeta.value.apiName !== candidate.siteSpace) {
    return {
      kind: 'fail',
      problem: `The matching _meta.json apiName must be "${candidate.siteSpace}" to match its Digital Experience site space.`,
      file: cmsMetaPath,
    };
  }

  const expectedSpace = `site/${candidate.siteSpace}`;

  const configResult = findXmlMetadata(
    metadataRoots,
    'digitalExperienceConfigs',
    '.digitalExperienceConfig-meta.xml',
    'DigitalExperienceConfig',
    parser,
    (metadata) => metadata.space === expectedSpace
  );

  if (configResult.kind === 'unknown') {
    return configResult;
  }

  if (configResult.kind === 'missing') {
    return {
      kind: 'fail',
      problem: `No DigitalExperienceConfig references space "${expectedSpace}".`,
    };
  }

  const networkResult = findXmlMetadata(
    metadataRoots,
    'networks',
    '.network-meta.xml',
    'Network',
    parser,
    (metadata) => metadata.picassoSite === candidate.siteSpace
  );

  if (networkResult.kind === 'unknown') {
    return networkResult;
  }

  if (networkResult.kind === 'missing') {
    return {
      kind: 'fail',
      problem: `No Network references Digital Experience site space "${candidate.siteSpace}" through picassoSite.`,
    };
  }

  const siteName = networkResult.value.site;

  if (typeof siteName !== 'string' || siteName.length === 0) {
    return {
      kind: 'fail',
      problem:
        'The matching Network does not reference a CustomSite through its site field.',
      file: networkResult.file,
    };
  }

  const customSiteResult = findCustomSite(metadataRoots, siteName, parser);

  if (customSiteResult.kind === 'unknown') {
    return customSiteResult;
  }

  if (customSiteResult.kind === 'missing') {
    return {
      kind: 'fail',
      problem: `The Network references CustomSite "${siteName}", but that CustomSite metadata was not found locally.`,
      file: networkResult.file,
    };
  }

  return {
    kind: 'pass',
    file: candidate.contentPath,
  };
}

export function checkExperienceLinkage(
  metadataRoots: string[],
  bundles: BundleInfo[],
  namespace: string
): ExperienceCheckResult {
  const diagnostics: DiagnosticResult[] = [];

  if (metadataRoots.length === 0) {
    return {
      diagnostics,
    };
  }

  const appNamespace = namespace.trim() || 'c';

  const experienceBundles = new Map<string, BundleInfo>();

  for (const bundle of bundles) {
    if (bundle.target === 'Experience' && !experienceBundles.has(bundle.name)) {
      experienceBundles.set(bundle.name, bundle);
    }
  }

  for (const [bundleName, bundle] of experienceBundles) {
    const expectedAppSpace = `${appNamespace}__${bundleName}`;
    const containerScan = scanExperienceContainers(metadataRoots, expectedAppSpace);

    let passResult: ChainEvaluation | undefined;
    let firstFail: ChainEvaluation | undefined;
    let firstUnknown: UnknownResult | undefined = containerScan.firstUnknown;

    for (const candidate of containerScan.candidates) {
      const evaluation = evaluateCandidate(metadataRoots, candidate, new XMLParser());

      if (evaluation.kind === 'pass') {
        passResult = evaluation;
        break;
      }

      if (evaluation.kind === 'unknown') {
        firstUnknown ??= evaluation;
        continue;
      }

      firstFail ??= evaluation;
    }

    if (passResult?.kind === 'pass') {
      diagnostics.push({
        id: 'MF-META-019',
        category: 'metadata',
        status: 'PASS',
        summary: `${bundleName}: linked to an Experience Cloud app container`,
        file: passResult.file,
      });

      continue;
    }

    if (firstUnknown) {
      diagnostics.push({
        id: 'MF-META-019',
        category: 'metadata',
        status: 'UNKNOWN',
        blocksReadiness: true,
        summary: `${bundleName}: Experience Cloud linkage could not be fully inspected`,
        problem: firstUnknown.problem,
        whyItMatters:
          'mf-check cannot safely conclude whether this Experience UI Bundle is linked when relevant Experience Cloud metadata cannot be read or interpreted.',
        remediation: [
          'Make sure the relevant Digital Experience, DigitalExperienceConfig, Network, and CustomSite metadata is readable and valid, then run mf-check again.',
        ],
        file: firstUnknown.file,
      });

      continue;
    }

    if (containerScan.candidates.length === 0 && containerScan.invalidContainer) {
      diagnostics.push({
        id: 'MF-META-019',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundleName}: matching Experience content is not an app container`,
        problem: `A Digital Experience content record references "${expectedAppSpace}", but appContainer is not true.`,
        whyItMatters:
          'An Experience UI Bundle must be hosted by a React app container to become the site rendering entry point.',
        remediation: [
          'Set contentBody.appContainer to true for the Digital Experience content record that references this UI Bundle.',
        ],
        file: containerScan.invalidContainer.file,
      });

      continue;
    }

    if (firstFail?.kind === 'fail') {
      const diagnostic: DiagnosticResult = {
        id: 'MF-META-019',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundleName}: Experience Cloud linkage is incomplete`,
        problem: firstFail.problem,
        whyItMatters:
          'The Experience UI Bundle cannot be confirmed as a complete user-facing Experience Cloud entry point unless the site metadata chain is intact.',
        remediation: [
          'Fix the Experience Cloud metadata linkage so the app container, site space, Network, and CustomSite references form a complete chain.',
        ],
      };

      if (firstFail.file) {
        diagnostic.file = firstFail.file;
      }

      diagnostics.push(diagnostic);

      continue;
    }

    diagnostics.push({
      id: 'MF-META-019',
      category: 'metadata',
      status: 'FAIL',
      summary: `${bundleName}: no Experience Cloud app container references this UI Bundle`,
      problem: `No readable Digital Experience content record was found with appContainer=true and appSpace="${expectedAppSpace}".`,
      whyItMatters:
        'An Experience UI Bundle needs a Digital Experience React app container that explicitly references its appSpace.',
      remediation: [
        `Create or update an sfdc_cms__site content record so contentBody.appContainer is true and contentBody.appSpace is "${expectedAppSpace}".`,
      ],
      file: bundle.path,
    });
  }

  return {
    diagnostics,
  };
}
