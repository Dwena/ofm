import { IsIn } from 'class-validator';

import { LEGAL_DOCUMENTS, LegalDocument } from '../legal-versions';

export class AcceptLegalDto {
  @IsIn(LEGAL_DOCUMENTS, { message: 'Unknown legal document' })
  document: LegalDocument;
}
