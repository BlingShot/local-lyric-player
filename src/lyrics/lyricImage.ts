import type { LyricLine } from './types';

export interface LyricImageOptions { lines: LyricLine[]; title: string; artist: string; family: string; translation: boolean; theme: 'night' | 'paper'; cover?: HTMLImageElement }
export function drawLyricImage(canvas: HTMLCanvasElement, options: LyricImageOptions) {
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image export is unavailable.');
  const paper = options.theme === 'paper', color = paper ? '#242820' : '#f1f6ec', secondary = paper ? '#5e6957' : '#b7c4b0';
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1080); gradient.addColorStop(0, paper ? '#faf3df' : '#132f28'); gradient.addColorStop(1, paper ? '#d9e0cc' : '#090e13'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1080);
  ctx.strokeStyle = paper ? '#9da48a' : '#4a6657'; ctx.lineWidth = 1; ctx.strokeRect(40, 40, 1000, 1000);
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
