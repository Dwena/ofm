import { buildSepaCreditTransfer, sepaText } from './sepa';

describe('SEPA credit transfer file (pain.001.001.03)', () => {
  const file = (overrides: Partial<Parameters<typeof buildSepaCreditTransfer>[0]> = {}) =>
    buildSepaCreditTransfer({
      messageId: 'FV-20261026-ABCD',
      createdAt: new Date('2026-10-26T06:00:00.000Z'),
      executionDate: '2026-10-26',
      debtor: { name: 'FanVIP SAS', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'agrifrpp' },
      transfers: [
        {
          endToEndId: 'PO-1',
          amount: 100.1,
          creditor: { name: 'Alice', iban: 'fr7612345678901234567890123', bic: null },
          remittanceInformation: 'FanVIP reversement createur PO-1',
        },
        {
          endToEndId: 'PO-2',
          amount: 0.2,
          creditor: { name: 'Bob', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
          remittanceInformation: 'FanVIP reversement createur PO-2',
        },
      ],
      ...overrides,
    });

  it('sums the transfers without float drift and counts them', () => {
    const xml = file();

    // 100.1 + 0.2 = 100.30000000000001 in floating point
    expect(xml.match(/<CtrlSum>100\.30<\/CtrlSum>/g)).toHaveLength(2);
    expect(xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)).toHaveLength(2);
    expect(xml).toContain('<InstdAmt Ccy="EUR">100.10</InstdAmt>');
    expect(xml).toContain('<InstdAmt Ccy="EUR">0.20</InstdAmt>');
  });

  it('writes the header, debtor and creditor accounts', () => {
    const xml = file();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
    expect(xml).toContain('<MsgId>FV-20261026-ABCD</MsgId>');
    expect(xml).toContain('<CreDtTm>2026-10-26T06:00:00</CreDtTm>');
    expect(xml).toContain('<ReqdExctnDt>2026-10-26</ReqdExctnDt>');
    // IBANs compacted and upper-cased, BIC upper-cased
    expect(xml).toContain('<IBAN>FR7630006000011234567890189</IBAN>');
    expect(xml).toContain('<IBAN>FR7612345678901234567890123</IBAN>');
    expect(xml).toContain('<BIC>AGRIFRPP</BIC>');
    expect(xml).toContain('<BIC>COBADEFFXXX</BIC>');
    // Creditor without BIC (allowed within SEPA)
    expect(xml).toContain('<Othr><Id>NOTPROVIDED</Id></Othr>');
    expect(xml).toContain('<EndToEndId>PO-1</EndToEndId>');
  });

  it('transliterates accents and drops characters outside the SEPA set', () => {
    expect(sepaText('Éloïse Müller-Ç', 70)).toBe('Eloise Muller-C');
    expect(sepaText('Tom & Jerry <SARL>', 70)).toBe('Tom Jerry SARL');
    expect(sepaText('  a   b  ', 70)).toBe('a b');
    expect(sepaText('x'.repeat(50), 35)).toHaveLength(35);
  });

  it('escapes XML special characters left by the SEPA character set', () => {
    const xml = file({
      debtor: { name: "L'atelier & Co", iban: 'FR7630006000011234567890189' },
      transfers: [
        {
          endToEndId: 'PO-3',
          amount: 10,
          creditor: { name: "Zoé d'Arc", iban: 'FR7612345678901234567890123' },
          remittanceInformation: 'Reversement <test> & co',
        },
      ],
    });

    expect(xml).toContain('<Nm>L&apos;atelier Co</Nm>');
    expect(xml).toContain('<Nm>Zoe d&apos;Arc</Nm>');
    expect(xml).toContain('<Ustrd>Reversement test co</Ustrd>');
    expect(xml).not.toMatch(/&(?!apos;|amp;|lt;|gt;|quot;)/);
  });

  it('refuses an empty file', () => {
    expect(() => file({ transfers: [] })).toThrow('A SEPA file needs at least one transfer');
  });
});
