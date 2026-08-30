import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';

type MetadataType = 'PermissionSet' | 'Profile';

export function readVisibleApplications(
  filePath: string,
  metadataType: MetadataType
): string[] {
  const xml = readFileSync(filePath, 'utf-8');
  SyntaxValidator.validate(xml);

  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const visibilities = parsed?.[metadataType]?.applicationVisibilities;

  if (!visibilities) {
    return [];
  }
  const visibilityList = Array.isArray(visibilities) ? visibilities : [visibilities];

  const visibleList = visibilityList.filter(
    (visibility) => visibility.visible === true && visibility.application
  );

  return visibleList.map((visibility) => String(visibility.application));
}
