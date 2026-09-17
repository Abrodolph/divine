import { supabase } from './supabase';

/**
 * All file handling goes through here.
 *
 * Two buckets:
 *   uploads  public — progress, material, drawing photos. Stored as a full URL.
 *   private  signed — muster/punch photos, worker photos, documents. Stored as
 *            'sb://private/{org_id}/{folder}/{file}' and turned into a
 *            short-lived signed URL only when displayed (resolveFileUrl).
 *            A folder named 'hr' is readable only with hr_documents access.
 *
 * Paths are prefixed with the company id (set once by AuthContext).
 */
const PUBLIC_BUCKET = 'uploads';
const PRIVATE_BUCKET = 'private';
const PRIVATE_SCHEME = `sb://${PRIVATE_BUCKET}/`;

let orgPrefix = '';
export function setUploadOrg(orgId) {
  orgPrefix = orgId ? `${orgId}/` : '';
}

export const isPrivateRef = (v) => typeof v === 'string' && v.startsWith(PRIVATE_SCHEME);
export const isPdfRef = (v) => /\.pdf(\?|$)/i.test(String(v ?? ''));
const isPdfFile = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * Shrink a camera photo before upload. Site phones shoot 4-8 MB images; at
 * 1280px / 70% quality they land around 150-250 KB, which uploads fine on a
 * weak site connection and still reads clearly when zoomed.
 */
export function resizeImage(file, maxW = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('That file is not a readable image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

async function put(body, folder, ext, contentType, isPrivate) {
  const bucket = isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET;
  const path = `${orgPrefix}${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType, cacheControl: '31536000' });
  if (error) throw error;
  if (isPrivate) return PRIVATE_SCHEME + path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Resize, upload, return the stored reference (public URL or private ref). */
export async function uploadPhoto(file, folder = 'misc', { private: isPrivate = false } = {}) {
  const blob = await resizeImage(file);
  return put(blob, folder, 'jpg', 'image/jpeg', isPrivate);
}

export async function uploadMany(files, folder = 'misc', opts) {
  return Promise.all([...files].map((f) => uploadPhoto(f, folder, opts)));
}

/** Like uploadPhoto, but PDFs go up as-is (canvas can't resize a PDF). */
export async function uploadAttachment(file, folder = 'misc', opts = {}) {
  if (!isPdfFile(file)) return uploadPhoto(file, folder, opts);
  return put(file, folder, 'pdf', 'application/pdf', !!opts.private);
}

export async function uploadManyAttachments(files, folder = 'misc', opts) {
  return Promise.all([...files].map((f) => uploadAttachment(f, folder, opts)));
}

const signed = new Map(); // ref -> { url, expires }

/** Anything stored by this module → a URL the browser can load right now. */
export async function resolveFileUrl(ref) {
  if (!ref || !isPrivateRef(ref)) return ref || null;
  const hit = signed.get(ref);
  if (hit && hit.expires > Date.now()) return hit.url;
  const path = ref.slice(PRIVATE_SCHEME.length);
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  signed.set(ref, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}
