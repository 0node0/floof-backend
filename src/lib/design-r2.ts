import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
}

export function readR2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || ""
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || ""
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || ""
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || ""
  const publicBaseUrl = (
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    ""
  ).replace(/\/$/, "")

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl }
}

export function isR2StagingEnabled(): boolean {
  return readR2ConfigFromEnv() != null
}

function client(cfg: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  })
}

export function r2ObjectKeyForDesign(id: string): string {
  return `designs/${id}`
}

export function publicR2DesignUrl(cfg: R2Config, id: string): string {
  return `${cfg.publicBaseUrl}/${r2ObjectKeyForDesign(id)}`
}

export async function putDesignToR2(
  id: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const cfg = readR2ConfigFromEnv()
  if (!cfg) throw new Error("R2 is not configured")

  const s3 = client(cfg)
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: r2ObjectKeyForDesign(id),
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  )
  return publicR2DesignUrl(cfg, id)
}

export async function getDesignFromR2(
  id: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cfg = readR2ConfigFromEnv()
  if (!cfg) return null

  try {
    const s3 = client(cfg)
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: r2ObjectKeyForDesign(id),
      })
    )
    const body = out.Body
    if (!body) return null
    const bytes = await body.transformToByteArray()
    return {
      buffer: Buffer.from(bytes),
      contentType: out.ContentType || "image/png",
    }
  } catch {
    return null
  }
}
