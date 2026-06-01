import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs/promises';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local', 'r2', or 'both'
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

let s3Client: S3Client | null = null;

if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function uploadFile(file: File | Blob, folder: string = '', storageTypeOverride?: string): Promise<string> {
  const rawFileName = (file as any).name || 'file';
  // Use a clean filename for the URL but keep the original for the disk if possible
  // Actually, it's better to just use a timestamped clean name
  const cleanFileName = rawFileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileName = `${Date.now()}-${cleanFileName}`;
  
  // Normalize folder for disk operations
  const normalizedFolder = folder.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  const filePath = path.join(UPLOAD_DIR, normalizedFolder, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  let resultUrl = '';
  const currentStorageType = storageTypeOverride || STORAGE_TYPE;

  // 1. Local Upload
  if (currentStorageType === 'local' || currentStorageType === 'both') {
    const fullDirPath = path.join(process.cwd(), UPLOAD_DIR, normalizedFolder);
    await fs.mkdir(fullDirPath, { recursive: true });
    await fs.writeFile(path.join(fullDirPath, fileName), buffer);
    
    // In local mode, we return the local URL
    // Ensure we use forward slashes for the URL path
    const urlPath = normalizedFolder; // already normalized to forward slashes
    resultUrl = `http://localhost:${process.env.PORT || 3001}/uploads/${urlPath ? urlPath + '/' : ''}${fileName}`;
    console.log(`[Storage] Saved local file: ${path.join(fullDirPath, fileName)}`);
    console.log(`[Storage] Generated URL: ${resultUrl}`);
  }

  // 2. R2 Upload
  if ((currentStorageType === 'r2' || currentStorageType === 'both') && s3Client && R2_BUCKET_NAME) {
    const key = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
    
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      },
    });

    await upload.done();
    
    // Use the R2 Public URL if provided, otherwise fallback to endpoint
    const r2Url = R2_PUBLIC_URL 
      ? `${R2_PUBLIC_URL}/${key}`
      : `${R2_ENDPOINT}/${R2_BUCKET_NAME}/${key}`;
    
    // If we are in 'r2' or 'both' mode, resultUrl is set to r2Url
    resultUrl = r2Url;
  }

  if (!resultUrl) {
    throw new Error('Upload failed: No storage configured or upload failed');
  }

  return resultUrl;
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return;

  // 1. Check if it's an R2 URL and we have configured s3Client
  const isR2Url = fileUrl.includes('.r2.dev') || (R2_PUBLIC_URL && fileUrl.startsWith(R2_PUBLIC_URL)) || (R2_ENDPOINT && fileUrl.includes(R2_ENDPOINT));
  
  if (isR2Url && s3Client && R2_BUCKET_NAME) {
    try {
      let key = '';
      if (R2_PUBLIC_URL && fileUrl.startsWith(R2_PUBLIC_URL)) {
        key = fileUrl.replace(`${R2_PUBLIC_URL}/`, '');
      } else {
        // Fallback: extract path after domain name
        const parsed = new URL(fileUrl);
        let pathname = parsed.pathname; // e.g. /chapters/1/1/file.png or /bucket/chapters/1/1/file.png
        
        // If it starts with bucket name, strip it
        if (pathname.startsWith(`/${R2_BUCKET_NAME}/`)) {
          pathname = pathname.replace(`/${R2_BUCKET_NAME}/`, '');
        } else if (pathname.startsWith('/')) {
          pathname = pathname.substring(1);
        }
        key = pathname;
      }

      if (key) {
        console.log(`[Storage] Deleting from R2: key="${key}"`);
        const command = new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
        });
        await s3Client.send(command);
        console.log(`[Storage] Successfully deleted from R2: key="${key}"`);
      }
    } catch (error: any) {
      console.error('[Storage] R2 deletion error:', error.message);
    }
  }

  // 2. Check if it's a local upload
  const isLocalUrl = fileUrl.startsWith('http://localhost') && fileUrl.includes('/uploads/');
  if (isLocalUrl || !fileUrl.startsWith('http')) {
    try {
      let relativePath = '';
      if (fileUrl.startsWith('http://localhost')) {
        const parsed = new URL(fileUrl);
        relativePath = parsed.pathname.replace(/^\/uploads\//, ''); // e.g. chapters/1/1/file.png
      } else {
        relativePath = fileUrl.replace(/^uploads\//, '');
      }

      if (relativePath) {
        const fullPath = path.join(process.cwd(), UPLOAD_DIR, relativePath);
        console.log(`[Storage] Deleting local file: ${fullPath}`);
        await fs.unlink(fullPath);
        console.log(`[Storage] Successfully deleted local file: ${fullPath}`);
      }
    } catch (error: any) {
      console.error('[Storage] Local deletion error:', error.message);
    }
  }
}
