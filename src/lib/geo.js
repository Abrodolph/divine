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
