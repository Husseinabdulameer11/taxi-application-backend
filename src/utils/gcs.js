
const path = require('path');
const { Storage } = require('@google-cloud/storage');

// Prefer environment variable for bucket name
const BUCKET_NAME = process.env.GCLOUD_BUCKET || process.env.GCLOUD_STORAGE_BUCKET;

// Support credentials from env var (for Render.com, etc.) or fallback to keyFilename
let storage;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  // Parse the JSON from the environment variable and fix private_key newlines
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentials = JSON.parse(raw);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }
  storage = new Storage({ credentials });
} else {
  // Fallback to keyFilename (local dev)
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../../taxi-application-476120-279f16f00a23.json');
  storage = new Storage({ keyFilename: keyFile });
}


function getBucket() {
  if (!BUCKET_NAME) throw new Error('GCS bucket name not configured. Set GCLOUD_BUCKET env var.');
  return storage.bucket(BUCKET_NAME);
}

async function uploadBuffer(buffer, destinationPath, contentType = 'application/octet-stream') {
  const bucket = getBucket();
  const file = bucket.file(destinationPath);
  const stream = file.createWriteStream({ metadata: { contentType } });

  return new Promise((resolve, reject) => {
    stream.on('error', (err) => reject(err));
    stream.on('finish', async () => {
      try {
        // Make the file public (optional). If you prefer private files, use signed URLs instead.
        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(file.name)}`;
        resolve(publicUrl);
      } catch (err) {
        reject(err);
      }
    });
    stream.end(buffer);
  });
}

async function getSignedUploadUrl(destinationPath, contentType = 'application/octet-stream', expiresSeconds = 15 * 60) {
  const bucket = getBucket();
  const file = bucket.file(destinationPath);
  // v4 signed URL for PUT (write)
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresSeconds * 1000,
    contentType
  });
  // Public URL (object will still be private unless you make it public)
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(file.name)}`;
  return { uploadUrl: url, publicUrl };
}

module.exports = { uploadBuffer, getSignedUploadUrl };

