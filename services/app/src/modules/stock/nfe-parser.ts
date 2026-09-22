// Parser de XML de NF-e (entrada) — schema SEFAZ nfeProc/procNFe (ADR-005). Função pura (recebe a
// string XML, devolve dados estruturados) — sem I/O, testável isoladamente.
//
// Segurança (security-engineer finding C-5, CVE-2026-25896/26278/33036): fast-xml-parser >=5.5.8
// + `processEntities: false` — desabilita processamento de entidades DOCTYPE inteiramente (não
// precisamos de entidades customizadas para parsear NF-e; XXE e DoS por expansão de entidade ficam
// estruturalmente impossíveis, não apenas mitigados por um limite).
import { XMLParser } from "fast-xml-parser";
import { ValidationError } from "@estoque-saas/shared";

export interface ParsedNfeItem {
  cProd: string;
  cEAN: string | null;
  xProd: string;
  ncm: string | null;
  qCom: number;
  vUnComCents: number;
}

export interface ParsedNfe {
  accessKey: string | null;
  supplierCnpj: string | null;
  supplierName: string | null;
  items: ParsedNfeItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  allowBooleanAttributes: true,
  // parseTagValue:false — SEM isto, fast-xml-parser converte texto numérico de tag em JS number
  // por padrão (ex: CNPJ "12345678000199", NCM "10063021", cEAN "7891234567890" viram number),
  // o que corrompe zeros à esquerda e overflow de precisão em códigos longos (não são quantidades,
  // são identificadores). Mantemos tudo como string e convertemos manualmente só os campos que
  // são de fato numéricos (qCom, vUnCom) via parseFloat — achado ao rodar os testes deste arquivo
  // (TDD: os testes de cEAN/NCM/CNPJ falharam antes desta opção, confirmando o bug).
  parseTagValue: false,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function centsFromDecimalString(value: unknown): number {
  const str = String(value ?? "0");
  const num = Number.parseFloat(str);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function parseNfeXml(xml: string): ParsedNfe {
  let doc: unknown;
  try {
    doc = parser.parse(xml, true);
  } catch {
    throw new ValidationError("XML de NF-e inválido ou malformado.");
  }

  const root = doc as Record<string, unknown>;
  const nfeProc = (root["nfeProc"] ?? root["NFe"]) as Record<string, unknown> | undefined;
  if (!nfeProc) {
    throw new ValidationError("XML não corresponde ao schema esperado (nfeProc/NFe).");
  }

  const nfe = (nfeProc["NFe"] ?? nfeProc) as Record<string, unknown>;
  const infNFe = nfe["infNFe"] as Record<string, unknown> | undefined;
  if (!infNFe) {
    throw new ValidationError("XML sem elemento infNFe.");
  }

  const accessKeyAttr = infNFe["@_Id"];
  const accessKey = typeof accessKeyAttr === "string" ? accessKeyAttr.replace(/^NFe/, "") : null;

  const emit = infNFe["emit"] as Record<string, unknown> | undefined;
  const supplierCnpj = typeof emit?.["CNPJ"] === "string" ? (emit["CNPJ"] as string) : null;
  const supplierName = typeof emit?.["xNome"] === "string" ? (emit["xNome"] as string) : null;

  const detList = toArray(infNFe["det"] as Record<string, unknown> | Record<string, unknown>[] | undefined);

  const items: ParsedNfeItem[] = detList.map((det) => {
    const prod = (det["prod"] ?? {}) as Record<string, unknown>;
    const cEANRaw = prod["cEAN"];
    const cEAN = typeof cEANRaw === "string" && cEANRaw.length > 0 && cEANRaw !== "SEM GTIN" ? cEANRaw : null;
    return {
      cProd: String(prod["cProd"] ?? ""),
      cEAN,
      xProd: String(prod["xProd"] ?? ""),
      ncm: typeof prod["NCM"] === "string" ? (prod["NCM"] as string) : null,
      qCom: Number.parseFloat(String(prod["qCom"] ?? "0")) || 0,
      vUnComCents: centsFromDecimalString(prod["vUnCom"]),
    };
  });

  return { accessKey, supplierCnpj, supplierName, items };
}
