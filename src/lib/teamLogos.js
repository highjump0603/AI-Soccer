// Static team-logo lookup. Drop image files into src/assets/logos/ (see the
// README there for the filename convention) and they're picked up here with
// no code changes — Vite inlines the glob at build time.
const logoModules = import.meta.glob('../assets/logos/*.{png,jpg,jpeg,webp,svg}', {
  eager: true,
  import: 'default',
});

function slugify(name) {
  return name
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

const logoMap = {};
for (const path in logoModules) {
  const filename = path.split('/').pop();
  const key = filename.slice(0, filename.lastIndexOf('.'));
  logoMap[key] = logoModules[path];
}

export function getTeamLogoUrl(name) {
  if (!name) return undefined;
  return logoMap[slugify(name)];
}
