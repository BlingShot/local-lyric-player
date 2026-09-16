import type { LyricLine } from './types';

export interface LyricImageTheme { id: string; name: string; background: [string, string]; text: string; secondary: string; border: string }
export const LYRIC_IMAGE_THEMES: readonly LyricImageTheme[] = [
  { id: 'night', name: 'Night', background: ['#132f28', '#090e13'], text: '#f1f6ec', secondary: '#b7c4b0', border: '#4a6657' },
  { id: 'paper', name: 'Paper', background: ['#faf3df', '#d9e0cc'], text: '#242820', secondary: '#5e6957', border: '#9da48a' },
  { id: 'midnight', name: 'Midnight', background: ['#263653', '#0c101f'], text: '#f2f3ff', secondary: '#bbc5df', border: '#536589' },
  { id: 'dusk', name: 'Dusk', background: ['#603e55', '#201f38'], text: '#fff0e5', secondary: '#ddbdc6', border: '#95677c' },
  { id: 'ocean', name: 'Ocean', background: ['#164651', '#09242d'], text: '#e7ffff', secondary: '#a9d4d7', border: '#4d838c' },
  { id: 'rose', name: 'Rose', background: ['#f6e6e0', '#dfc9d8'], text: '#382731', secondary: '#755d6c', border: '#b59daa' },
  { id: 'monochrome', name: 'Monochrome', background: ['#292929', '#101010'], text: '#fafafa', secondary: '#c1c1c1', border: '#626262' },
];
// Imported themes are data, never CSS, remote images, HTML, or executable code.
export function parseLyricImageTheme(source: string): LyricImageTheme {
  if (source.length > 16384) throw new Error('Theme files must be smaller than 16 KB.');
  const value = JSON.parse(source);
  const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 ||
      !Array.isArray(value.background) || value.background.length !== 2 || !value.background.every(color) ||
      !color(value.text) || !color(value.secondary) || !color(value.border)) throw new Error('Invalid image theme. Use the exported JSON template.');
  return { id: 'custom', name: value.name.trim(), background: [value.background[0], value.background[1]], text: value.text, secondary: value.secondary, border: value.border };
}
export function lyricImageSelection(lines: readonly LyricLine[], time: number): string[] {
  if (!lines.length) return [];
  const current = lines.findIndex(line => line.role === 'lead' && line.start <= time && time < (line.end ?? Infinity));
  const audible = current >= 0 ? current : lines.findIndex(line => line.start <= time && time < (line.end ?? Infinity));
  const previous = lines.reduce((index, line, i) => line.start <= time ? i : index, -1);
  const index = audible >= 0 ? audible : Math.max(0, previous);
  return lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).map(line => line.id);
}
export interface LyricImageOptions { lines: LyricLine[]; title: string; artist: string; family: string; translation: boolean; theme: string | LyricImageTheme; cover?: HTMLImageElement }
export function drawLyricImage(canvas: HTMLCanvasElement, options: LyricImageOptions) {
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image export is unavailable.');
  const theme = typeof options.theme === 'string' ? LYRIC_IMAGE_THEMES.find(item => item.id === options.theme) || LYRIC_IMAGE_THEMES[0] : options.theme;
  const color = theme.text, secondary = theme.secondary;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1080); gradient.addColorStop(0, theme.background[0]); gradient.addColorStop(1, theme.background[1]); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1080);
  ctx.strokeStyle = theme.border; ctx.lineWidth = 1; ctx.strokeRect(40, 40, 1000, 1000);
  const wrap = (text: string, width: number) => {
    const result: string[] = []; let line = '';
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.replace(/\r?\n/g, ' '))) {
      const word = segment.segment;
      if (ctx.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) result.push(line.trimEnd()); line = '';
      for (const piece of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.trimStart())) {
        if (line && ctx.measureText(line + piece.segment).width > width) { result.push(line); line = ''; } line += piece.segment;
      }
    }
    if (line.trim()) result.push(line.trimEnd()); return result;
  };
  const layout = (size: number) => options.lines.flatMap(line => {
    const font = line.role === 'background' ? size * .76 : size;
    ctx.font = `700 ${font}px ${options.family}`;
    const rows = wrap(line.parts.map(part => part.text).join(''), 900).map(text => ({ text, font, color, space: font * 1.26 }));
    if (options.translation) for (const annotation of line.annotations.filter(a => a.kind === 'translation')) {
      const font = size * .52; ctx.font = `500 ${font}px ${options.family}`;
      rows.push(...wrap(annotation.text, 900).map(text => ({ text, font, color: secondary, space: font * 1.4 })));
    }
    if (rows.length) rows[rows.length - 1].space += size * .38;
    return rows;
  });
  if (!options.lines.length) throw new Error('Select at least one lyric line.');
  let size = 64, rows = layout(size);
  while (rows.reduce((sum, row) => sum + row.space, 0) > 710 && size > 22) rows = layout(--size);
  const height = rows.reduce((sum, row) => sum + row.space, 0);
  if (height > 710) throw new Error('Too much text for one square. Select fewer lines.');
  ctx.textBaseline = 'top'; let y = 104 + Math.max(0, (710 - height) / 2);
  for (const row of rows) { ctx.font = `${row.color === color ? 700 : 500} ${row.font}px ${options.family}`; ctx.fillStyle = row.color; ctx.fillText(row.text, 90, y); y += row.space; }
  const cover = options.cover;
  const hasCover = !!cover && cover.naturalWidth > 0 && cover.naturalHeight > 0;
  const metadataX = hasCover ? 226 : 90, metadataWidth = 990 - metadataX;
  if (hasCover && cover) {
    const x = 90, y = 888, edge = 112, radius = 10;
    const crop = Math.min(cover.naturalWidth, cover.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + edge - radius, y);
    ctx.quadraticCurveTo(x + edge, y, x + edge, y + radius);
    ctx.lineTo(x + edge, y + edge - radius);
    ctx.quadraticCurveTo(x + edge, y + edge, x + edge - radius, y + edge);
    ctx.lineTo(x + radius, y + edge);
    ctx.quadraticCurveTo(x, y + edge, x, y + edge - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(cover, (cover.naturalWidth - crop) / 2, (cover.naturalHeight - crop) / 2, crop, crop, x, y, edge, edge);
    ctx.restore();
  }
  ctx.fillStyle = secondary; ctx.fillRect(metadataX, 876, 54, 3);
  ctx.font = `700 30px ${options.family}`; ctx.fillStyle = color;
  const title = wrap(options.title, metadataWidth);
  if (title.length) ctx.fillText(title[0] + (title.length > 1 ? '...' : ''), metadataX, 908, metadataWidth);
  ctx.font = `500 23px ${options.family}`; ctx.fillStyle = secondary;
  const artist = wrap(options.artist, metadataWidth);
  if (artist.length) ctx.fillText(artist[0] + (artist.length > 1 ? '...' : ''), metadataX, 952, metadataWidth);
}
