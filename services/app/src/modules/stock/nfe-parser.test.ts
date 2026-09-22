import { describe, expect, it } from "vitest";
import { parseNfeXml } from "./nfe-parser";

const SAMPLE_NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260112345678000199550010000001231000001234" versao="4.00">
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Fornecedor Exemplo LTDA</xNome>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>SKU-001</cProd>
          <cEAN>7891234567890</cEAN>
          <xProd>Arroz Tipo 1 5kg</xProd>
          <NCM>10063021</NCM>
          <qCom>10.0000</qCom>
          <vUnCom>25.90</vUnCom>
          <vProd>259.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>SKU-002</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>Produto sem código de barras</xProd>
          <qCom>3.0000</qCom>
          <vUnCom>12.50</vUnCom>
          <vProd>37.50</vProd>
        </prod>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;

describe("parseNfeXml", () => {
  it("extracts the access key from infNFe/@Id", () => {
    const result = parseNfeXml(SAMPLE_NFE_XML);
    expect(result.accessKey).toBe("35260112345678000199550010000001231000001234");
  });

  it("extracts supplier CNPJ and name from emit", () => {
    const result = parseNfeXml(SAMPLE_NFE_XML);
    expect(result.supplierCnpj).toBe("12345678000199");
    expect(result.supplierName).toBe("Fornecedor Exemplo LTDA");
  });

  it("parses each det/prod item, converting vUnCom to integer cents", () => {
    const result = parseNfeXml(SAMPLE_NFE_XML);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      cProd: "SKU-001",
      cEAN: "7891234567890",
      xProd: "Arroz Tipo 1 5kg",
      ncm: "10063021",
      qCom: 10,
      vUnComCents: 2590,
    });
  });

  it("normalizes 'SEM GTIN' cEAN to null (no barcode match possible)", () => {
    const result = parseNfeXml(SAMPLE_NFE_XML);
    expect(result.items[1]?.cEAN).toBeNull();
  });

  it("throws ValidationError on malformed/unexpected XML", () => {
    expect(() => parseNfeXml("<not-nfe><foo></not-nfe>")).toThrow();
    expect(() => parseNfeXml("<somethingElse/>")).toThrow(/nfeProc/);
  });

  it("never expands DOCTYPE entities (XXE/entity-expansion hardening)", () => {
    const malicious = `<?xml version="1.0"?>
<!DOCTYPE nfeProc [<!ENTITY xxe "pwned">]>
<nfeProc><NFe><infNFe Id="NFe1"><det><prod><cProd>&xxe;</cProd><xProd>x</xProd><qCom>1</qCom><vUnCom>1</vUnCom></prod></det></infNFe></NFe></nfeProc>`;
    const result = parseNfeXml(malicious);
    // processEntities:false -> a entidade NÃO é expandida (permanece literal ou é removida),
    // nunca deve conter o valor "pwned" injetado pela entidade.
    expect(result.items[0]?.cProd).not.toBe("pwned");
  });
});
