# Loop: t3a-nfe-parser-tdd

```yaml
loop:
  goal:     parseNfeXml() extrai corretamente campos de um XML nfeProc (SEFAZ), incluindo
            hardening contra XXE/entity-expansion (security-engineer finding C-5)
  producer: software-engineer (este agente)
  oracle:   vitest run src/modules/stock/nfe-parser.test.ts (Tier 1, executável)
  delta:    output de teste falhando por iteração
  ratchet:  testes falhando (baseline 6 escritos antes de qualquer implementação rodar)
  budget:   5 iterações (inner loop, loop-protocol Rule 10 modo standard)
  exit:     converged
```

- iter 1: 6 testes escritos (TDD, ainda sem `parseTagValue:false`) — 4 passed / 2 failed
  (cEAN/NCM e supplierCnpj/supplierName vinham `null` — fast-xml-parser convertia texto numérico
  de tag para `number`, corrompendo zeros à esquerda de CNPJ/EAN/NCM)
- iter 2: adicionado `parseTagValue: false` ao XMLParser — 6 passed / 0 failed
- exit: converged (6/6, sem regressão nas execuções seguintes do oracle.sh)
