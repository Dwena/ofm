/**
 * SEPA Credit Transfer initiation file (ISO 20022 pain.001.001.03), the
 * format French banks accept for bulk transfers uploaded from their business
 * banking portal (or sent through EBICS).
 */

export interface SepaParty {
  name: string;
  iban: string;
  bic?: string | null;
}

export interface SepaTransfer {
  /** Unique id carried to the creditor's statement (max 35 chars) */
  endToEndId: string;
  /** Euros */
  amount: number;
  creditor: SepaParty;
  /** Free text shown on the creditor's statement (max 140 chars) */
  remittanceInformation: string;
}

export interface SepaCreditTransferFile {
  /** Unique id of the file (max 35 chars) */
  messageId: string;
  createdAt: Date;
  /** Requested execution date (YYYY-MM-DD) */
  executionDate: string;
  debtor: SepaParty;
  transfers: SepaTransfer[];
}

/** Characters allowed by the SEPA rulebook (Latin subset); accents are transliterated */
export function sepaText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const compactIban = (iban: string) => iban.replace(/\s+/g, '').toUpperCase();
const amountText = (amount: number) => (Math.round(amount * 100) / 100).toFixed(2);

function agent(bic?: string | null): string {
  return bic
    ? `<FinInstnId><BIC>${escapeXml(bic.replace(/\s+/g, '').toUpperCase())}</BIC></FinInstnId>`
    : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';
}

export function buildSepaCreditTransfer(file: SepaCreditTransferFile): string {
  if (file.transfers.length === 0) {
    throw new Error('A SEPA file needs at least one transfer');
  }

  const total = file.transfers.reduce((sum, transfer) => sum + Math.round(transfer.amount * 100), 0) / 100;
  const messageId = sepaText(file.messageId, 35);
  const createdAt = file.createdAt.toISOString().slice(0, 19);
  const debtorName = escapeXml(sepaText(file.debtor.name, 70));

  const transfers = file.transfers
    .map(
      (transfer) => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${escapeXml(sepaText(transfer.endToEndId, 35))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${amountText(transfer.amount)}</InstdAmt></Amt>
        <CdtrAgt>${agent(transfer.creditor.bic)}</CdtrAgt>
        <Cdtr><Nm>${escapeXml(sepaText(transfer.creditor.name, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${escapeXml(compactIban(transfer.creditor.iban))}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${escapeXml(sepaText(transfer.remittanceInformation, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(messageId)}</MsgId>
      <CreDtTm>${createdAt}</CreDtTm>
      <NbOfTxs>${file.transfers.length}</NbOfTxs>
      <CtrlSum>${amountText(total)}</CtrlSum>
      <InitgPty><Nm>${debtorName}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(messageId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${file.transfers.length}</NbOfTxs>
      <CtrlSum>${amountText(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${file.executionDate}</ReqdExctnDt>
      <Dbtr><Nm>${debtorName}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${escapeXml(compactIban(file.debtor.iban))}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agent(file.debtor.bic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${transfers}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
