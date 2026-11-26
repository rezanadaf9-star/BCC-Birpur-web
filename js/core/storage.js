import * as FB from './firebase-client.js';
import { ref, getBlob, getDownloadURL, uploadBytes, uploadBytesResumable, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
const urls = new Map();
const pendingUrls = new Map();

/** Small private images (photos) are shown through download URLs. Bucket names are folders inside Firebase Storage. */
export async function signed(path, seconds = 3600, bucket = 'bcc-content') {
  if (!path) return null;
  const k = bucket + '/' + path, hit = urls.get(k);
  if (hit && hit.exp > Date.now()) return hit.url;
  if (pendingUrls.has(k)) return pendingUrls.get(k);
  const request = getDownloadURL(ref(FB.storage, k))
    .then(url => {
      urls.set(k, { url, exp: Date.now() + Math.max(60, seconds - 60) * 1000 });
      return url;
    })
    .catch(() => null)
    .finally(() => pendingUrls.delete(k));
  pendingUrls.set(k, request);
  return request;
}

/** Compress an image in the browser before upload (max 800px, JPEG). */
export function compressImage(file, max = 800, quality = .82) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
    c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => b ? res(b) : rej(new Error('Could not process the image.')), 'image/jpeg', quality); };
    img.onerror = () => rej(new Error('That file is not a valid image.')); img.src = URL.createObjectURL(file); });
}
/** Student / teacher profile photos. */
export const photo = path => signed(path, 3600, 'student-photos');
const extOf = f => (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Upload a file; returns { path, ext }. Folder example: "answer-sheets/10". */
export async function upload(bucket, file, folder) {
  const ext = extOf(file), path = `${folder}/${crypto.randomUUID()}.${ext}`;
  await uploadBytes(ref(FB.storage, `${bucket}/${path}`), file, { contentType: file.type || undefined }); return { path, ext };
}
export const removeFile = (bucket, path) => path ? deleteObject(ref(FB.storage, `${bucket}/${path}`)).catch(() => {}) : null;
/** Upload with a progress bar. onProgress(0..100). */
export async function uploadWithProgress(bucket, file, folder, onProgress) {
  const ext = extOf(file), path = `${folder}/${crypto.randomUUID()}.${ext}`;
  await new Promise((res, rej) => { const t = uploadBytesResumable(ref(FB.storage, `${bucket}/${path}`), file, { contentType: file.type || undefined });
    t.on('state_changed', s => onProgress?.(Math.round(s.bytesTransferred * 100 / s.totalBytes)), () => rej(new Error('Upload failed. Check your internet connection.')), res); });
  return { path, ext };
}
/** Upload a profile photo as "<uid>.jpg" (the only name the storage rules accept) and tell the server. */
export async function uploadProfilePhoto(uid, blob, forUserId) {
  await uploadBytes(ref(FB.storage, `student-photos/${uid}.jpg`), blob, { contentType: 'image/jpeg' });
  return FB.call('setProfilePhoto', forUserId ? { user_id: forUserId } : {});
}
/** Private files (notes, homework): fetched through the SDK so the storage rules are checked every time. No shareable link is ever created. */
const blobs = new Map();
export async function fileBlobUrl(path, bucket = 'bcc-content') {
  const k = bucket + '/' + path; if (blobs.has(k)) return blobs.get(k);
  const url = URL.createObjectURL(await getBlob(ref(FB.storage, k))); blobs.set(k, url); return url;
}
