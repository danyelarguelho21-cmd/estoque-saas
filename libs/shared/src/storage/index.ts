// Abstração de armazenamento de arquivo (ADR-005) — upload de XML de NF-e e CSV de produtos.
// LocalFileStorage: volume local em dev (diretório configurável via UPLOADS_DIR).
// Produção: trocar a implementação por uma que fale com S3/MinIO, sem tocar nos módulos de
// domínio (mesma estratégia de indireção do PaymentProvider — ADR-004).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
