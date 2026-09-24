"use client";

import type { ProductLabel } from "@/lib/api/types";

const LEFT: Record<string, string> = {
  "0": "0001101", "1": "0011001", "2": "0010011", "3": "0111101", "4": "0100011",
  "5": "0110001", "6": "0101111", "7": "0111011", "8": "0110111", "9": "0001011",
};
const LEFT_G: Record<string, string> = {
  "0": "0100111", "1": "0110011", "2": "0011011", "3": "0100001", "4": "0011101",
  "5": "0111001", "6": "0000101", "7": "0010001", "8": "0001001", "9": "0010111",
};
const RIGHT: Record<string, string> = {
  "0": "1110010", "1": "1100110", "2": "1101100", "3": "1000010", "4": "1011100",
  "5": "1001110", "6": "1010000", "7": "1000100", "8": "1001000", "9": "1110100",
};
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function ean13Bits(code: string) {
  if (!/^\d{13}$/.test(code)) return null;
  const parity = PARITY[Number(code[0])];
  if (!parity) return null;
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? LEFT : LEFT_G)[code[i]!]!;
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += RIGHT[code[i]!]!;
  return `${bits}101`;
}

function EanBarcode({ code }: { code: string }) {
  const bits = ean13Bits(code);
  if (!bits) return <p className="label-barcode-text">Código: {code}</p>;
  return (
    <svg className="label-barcode" viewBox="0 0 95 42" role="img" aria-label={`Código de barras ${code}`}>
      {bits.split("").map((bit, index) => bit === "1" ? <rect key={index} x={index} y={0} width="1" height="34" fill="#000" /> : null)}
      <text x="47.5" y="41" textAnchor="middle" fontSize="6" fontFamily="monospace">{code}</text>
    </svg>
  );
}

export function ProductLabelSheet({ labels }: { labels: ProductLabel[] }) {
  if (!labels.length) return null;
  return (
    <div id="print-labels" aria-hidden="true">
      {labels.map((label) => (
        <article className="product-label" key={label.id}>
          <strong>{label.name}</strong>
          {label.sku && <span>SKU: {label.sku}</span>}
          <EanBarcode code={label.barcode} />
        </article>
      ))}
    </div>
  );
}
