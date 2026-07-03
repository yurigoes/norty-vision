import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";
import { loadEnv } from "../config";

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly env = loadEnv();

  constructor() {
    this.client = new S3Client({
      endpoint: this.env.MINIO_ENDPOINT,
      region: this.env.MINIO_REGION,
      credentials: {
        accessKeyId: this.env.MINIO_ACCESS_KEY,
        secretAccessKey: this.env.MINIO_SECRET_KEY,
      },
      forcePathStyle: true, // MinIO usa path-style
    });
  }

  /**
   * Faz upload de um buffer no bucket publico (logos, avatares, og:image).
   * Retorna a URL final navegavel via Caddy: /storage/yugo-public/<key>.
   */
  async putPublic(opts: {
    keyPrefix: string;
    contentType: string;
    body: Buffer;
    originalName?: string;
  }): Promise<{ key: string; url: string }> {
    const ext = pickExtension(opts.contentType, opts.originalName);
    const random = randomBytes(8).toString("hex");
    const ts = Date.now();
    const key = `${opts.keyPrefix}/${ts}-${random}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.MINIO_BUCKET_PUBLIC,
        Key: key,
        Body: opts.body,
        ContentType: opts.contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const url = `${this.env.MINIO_PUBLIC_BASE_URL}/${this.env.MINIO_BUCKET_PUBLIC}/${key}`;
    return { key, url };
  }

  async deletePublic(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.env.MINIO_BUCKET_PUBLIC,
        Key: key,
      }),
    );
  }

  /**
   * Upload no bucket PRIVADO (KYC, documentos sensíveis). NÃO é navegável
   * direto — só servido via endpoint autenticado (getPrivate). Retorna a key.
   */
  async putPrivate(opts: {
    keyPrefix: string;
    contentType: string;
    body: Buffer;
    originalName?: string;
  }): Promise<{ key: string }> {
    const ext = pickExtension(opts.contentType, opts.originalName);
    const key = `${opts.keyPrefix}/${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.MINIO_BUCKET_PRIVATE,
        Key: key,
        Body: opts.body,
        ContentType: opts.contentType,
      }),
    );
    return { key };
  }

  /** Lê um objeto do bucket privado como buffer (pra servir autenticado). */
  async getPrivate(key: string): Promise<{ body: Buffer; contentType: string }> {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.MINIO_BUCKET_PRIVATE, Key: key }),
    );
    const bytes = await (r.Body as any).transformToByteArray();
    return { body: Buffer.from(bytes), contentType: r.ContentType ?? "application/octet-stream" };
  }
}

function pickExtension(contentType: string, originalName?: string): string {
  if (originalName) {
    const m = originalName.toLowerCase().match(/\.[a-z0-9]{2,5}$/);
    if (m) return m[0];
  }
  switch (contentType) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "image/svg+xml": return ".svg";
    case "image/x-icon":
    case "image/vnd.microsoft.icon": return ".ico";
    default: return "";
  }
}
