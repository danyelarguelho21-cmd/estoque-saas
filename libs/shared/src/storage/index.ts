// Abstração de armazenamento de arquivo (ADR-005) — upload de XML de NF-e e CSV de produtos.
// LocalFileStorage: volume local em dev (diretório configurável via UPLOADS_DIR).
// Produção: trocar a implementação por uma que fale com S3/MinIO, sem tocar nos módulos de
// domínio (mesma estratégia de indireção do PaymentProvider — ADR-004).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../errors/index";

// security-engineer finding H-3: upload de NF-e XML / CSV de produtos não tinha NENHUM limite de
// tamanho declarado — qualquer usuário autenticado com permissão de escrita podia enviar um
// arquivo arbitrariamente grande, e como o worker de parsing (BullMQ) é um processo ÚNICO
// COMPARTILHADO por todos os tenants (ADR-001), um upload gigante de um tenant esgota
// CPU/memória para os jobs de billing/alertas de TODOS os outros tenants. Limites deliberadamente
// generosos para o caso de uso legítimo (NF-e SEFAZ real: tipicamente dezenas de KB; CSV de
// catálogo: até algumas dezenas de milhares de linhas) — o objetivo é bloquear o caso abusivo
// (centenas de MB / GB), não apertar o caso normal.
export const MAX_NFE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_CSV_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB

// Valida o tamanho declarado do upload ANTES de ler o arquivo inteiro para um Buffer em memória —
// rejeita cedo (o `File`/`Blob` do multipart form já expõe `.size` sem precisar materializar o
// conteúdo), para que o próprio ato de checar o limite não seja, em si, o vetor de exaustão de
// memória que a checagem existe para prevenir.
export function assertUploadSizeWithinLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new ValidationError(`Arquivo excede o tamanho máximo permitido (${maxMb}MB).`, {
      maxBytes,
      receivedBytes: sizeBytes,
    });
  }
}

export interface FileStorage {
  save(buffer: Buffer, originalName: string): Promise<string>; // retorna fileRef
  read(fileRef: string): Promise<Buffer>;
}

export class LocalFileStorage implements FileStorage {
  constructor(private readonly baseDir: string = process.env.UPLOADS_DIR ?? "./.data/uploads") {}

  async save(buffer: Buffer, originalName: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const safeExt = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, "");
    const fileRef = `${randomUUID()}${safeExt}`;
    await writeFile(path.join(this.baseDir, fileRef), buffer);
    return fileRef;
  }

  async read(fileRef: string): Promise<Buffer> {
    return readFile(path.join(this.baseDir, fileRef));
  }
}

export const defaultFileStorage: FileStorage = new LocalFileStorage();
