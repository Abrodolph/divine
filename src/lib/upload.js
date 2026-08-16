import { supabase } from './supabase';

const BUCKET = 'uploads';

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

/** Resize, upload to Storage, return the public URL. */
export async function uploadPhoto(file, folder = 'misc') {
  const blob = await resizeImage(file);
  const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(name, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
  return data.publicUrl;
}

export async function uploadMany(files, folder = 'misc') {
  return Promise.all([...files].map((f) => uploadPhoto(f, folder)));
}
