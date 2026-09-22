// Parser de CSV de produtos — função pura, sem I/O. Suporta o subconjunto de RFC4180 necessário
// para este caso de uso (campos entre aspas com vírgula/aspas escapadas "").
// Cabeçalho esperado (mesmos nomes de campo de catalog.yaml#ProductInput):
// sku,name,categoryId,unitOfMeasure,barcode,supplierId,isPerishable,minStockGlobal,costPriceCents,salePriceCents

export interface CsvProductRow {
  sku: string;
  name: string;
  categoryId?: string | undefined;
  unitOfMeasure: string;
  barcode?: string | undefined;
  supplierId?: string | undefined;
  isPerishable?: boolean | undefined;
  minStockGlobal?: number | undefined;
  costPriceCents?: number | undefined;
  salePriceCents?: number | undefined;
}

export interface CsvParseResult {
  rows: CsvProductRow[];
  errors: Array<{ line: number; message: string }>;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

const REQUIRED_COLUMNS = ["sku", "name", "unitOfMeasure"] as const;

export function parseProductsCsv(csvText: string): CsvParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "Arquivo CSV vazio." }] };
  }

  const header = parseCsvLine(lines[0] ?? "");
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, message: `Colunas obrigatórias ausentes: ${missing.join(", ")}` }] };
  }

  const rows: CsvProductRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const values = parseCsvLine(raw);
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = values[idx] ?? "";
    });

    if (!record["sku"] || !record["name"] || !record["unitOfMeasure"]) {
      errors.push({ line: i + 1, message: "Campos obrigatórios (sku, name, unitOfMeasure) ausentes." });
      continue;
    }

    const row: CsvProductRow = {
      sku: record["sku"],
      name: record["name"],
      unitOfMeasure: record["unitOfMeasure"],
    };
    if (record["categoryId"]) row.categoryId = record["categoryId"];
    if (record["barcode"]) row.barcode = record["barcode"];
    if (record["supplierId"]) row.supplierId = record["supplierId"];
    if (record["isPerishable"]) row.isPerishable = record["isPerishable"].toLowerCase() === "true";
    if (record["minStockGlobal"]) row.minStockGlobal = Number.parseInt(record["minStockGlobal"], 10) || 0;
    if (record["costPriceCents"]) row.costPriceCents = Number.parseInt(record["costPriceCents"], 10) || 0;
    if (record["salePriceCents"]) row.salePriceCents = Number.parseInt(record["salePriceCents"], 10) || 0;

    rows.push(row);
  }

  return { rows, errors };
}
