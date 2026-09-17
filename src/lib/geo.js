/** Promise wrapper around the browser geolocation API. */
export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device does not support location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy_m: Math.round(pos.coords.accuracy),
        }),
      (err) => {
        const messages = {
          1: 'Location permission was denied. Allow location for this site in your browser settings.',
          2: 'Location is unavailable right now — step outside or check GPS is on.',
          3: 'Getting location took too long. Try again.',
        };
        reject(new Error(messages[err.code] || err.message));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

export const mapsLink = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;

/** Straight-line distance in metres (haversine) — mirrors geo_distance_m() in the schema. */
export function distanceM(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || v === '')) return null;
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const a = Math.sin((rad(lat2) - rad(lat1)) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin((rad(lng2) - rad(lng1)) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

export const fmtDistance = (m) => (m === null || m === undefined ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
