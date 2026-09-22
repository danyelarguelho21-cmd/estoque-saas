// Minimal valid nfeProc/procNFe XML fixture builder (ADR-005) — enough `det/prod` structure for
// parser + import-flow tests without depending on a real SEFAZ-issued document.

export interface NfeItemFixture {
  cProd: string;
  cEAN?: string;
  xProd: string;
  uCom?: string;
  qCom: number;
  vUnCom: number;
}

export function makeNfeItem(overrides: Partial<NfeItemFixture> = {}): NfeItemFixture {
  return {
    cProd: overrides.cProd ?? "PROD001",
    cEAN: overrides.cEAN ?? "7891000100103",
    xProd: overrides.xProd ?? "Arroz Branco 5kg",
    uCom: overrides.uCom ?? "UN",
    qCom: overrides.qCom ?? 10,
    vUnCom: overrides.vUnCom ?? 25.9,
  };
}

/** Builds a minimal but well-formed nfeProc XML string with the given items. */
export function makeNfeXml(items: NfeItemFixture[] = [makeNfeItem()]): string {
  const det = items
    .map(
      (item, idx) => `
    <det nItem="${idx + 1}">
      <prod>
        <cProd>${item.cProd}</cProd>
        <cEAN>${item.cEAN ?? ""}</cEAN>
        <xProd>${item.xProd}</xProd>
        <uCom>${item.uCom ?? "UN"}</uCom>
        <qCom>${item.qCom.toFixed(4)}</qCom>
        <vUnCom>${item.vUnCom.toFixed(2)}</vUnCom>
        <vProd>${(item.qCom * item.vUnCom).toFixed(2)}</vProd>
      </prod>
    </det>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe35260900000000000000550010000000011000000010" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>Venda</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>1</nNF>
        <dhEmi>2026-09-15T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Fornecedor Teste LTDA</xNome>
      </emit>
${det}
    </infNFe>
  </NFe>
</nfeProc>`;
}

/** Deliberately malformed XML — for the "parsing fails, import marked status=failed" case (ADR-005). */
export function makeMalformedNfeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe>UNCLOSED`;
}
