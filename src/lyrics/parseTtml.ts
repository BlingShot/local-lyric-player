import { LyricsError, timingKind, type LyricDocument, type LyricLine, type LyricPart } from './types.ts';

// Namespace identifiers only; these URLs are never requested.
const TT = 'http://www.w3.org/ns/ttml';
const META = 'http://www.w3.org/ns/ttml#metadata';
const PARAM = 'http://www.w3.org/ns/ttml#parameter';
const STYLE = 'http://www.w3.org/ns/ttml#styling';
const XML = 'http://www.w3.org/XML/1998/namespace';
const APPLE = 'http://music.apple.com/lyric-ttml-internal';
const attr = (element: Element, name: string, namespace?: string) => namespace ? element.getAttributeNS(namespace, name) : element.getAttribute(name);
const children = (element: Element) => [...element.children];
const named = (element: Element, name: string) => [...element.getElementsByTagNameNS('*', name)];
interface Bounds { start: number; end: number }

export function parseTtml(source: string): LyricDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new LyricsError('TTML with DTD or entity declarations is not supported. Export a plain TTML file.');
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.getElementsByTagNameNS('*', 'parsererror').length) throw new LyricsError('This TTML file is not valid XML. Check its closing tags and namespace declarations.');
  const root = xml.documentElement;
  if (root.localName !== 'tt' || (root.namespaceURI && root.namespaceURI !== TT)) throw new LyricsError('Expected a TTML <tt> document.');
  const elements = [root, ...root.getElementsByTagName('*')];
  if (elements.length > 50000) throw new LyricsError('This TTML file exceeds the limit of 50,000 elements.');
  const body = children(root).find(element => element.localName === 'body');
  if (!body) throw new LyricsError('This TTML file has no lyric body.');
  const notices = new Set<string>(), agents: Record<string, string> = Object.create(null);
  if (children(root).filter(element => element.localName === 'body').length !== 1 || children(root).some(element => !['head', 'body'].includes(element.localName))) {
    throw new LyricsError('TTML must contain one body and an optional head. Other root structures are not supported.');
  }
  const apple = elements.some(element => [...element.attributes].some(a => a.namespaceURI === APPLE && ['timing', 'key'].includes(a.localName)))
    || elements.some(element => element.prefix === 'amll');
  const timeBase = attr(root, 'timeBase', PARAM);
  if (timeBase && timeBase !== 'media') throw new LyricsError(`TTML timeBase="${timeBase}" is not supported. Export media-time lyrics.`);
  for (const element of elements) {
    if (attr(element, 'timeContainer') && attr(element, 'timeContainer') !== 'par') throw new LyricsError('Sequential TTML time containers are not supported. Export explicit begin/end times with parallel containers.');
    if (['set', 'animate', 'animation', 'audio', 'image', 'resources'].includes(element.localName)) throw new LyricsError(`TTML <${element.localName}> is not supported. No lyrics were replaced.`);
    for (const a of [...element.attributes]) {
      if (['repeatCount', 'repeatDur', 'condition'].includes(a.localName)) throw new LyricsError(`TTML ${a.localName} is not supported. Export a fixed lyric timeline.`);
      if (a.namespaceURI === STYLE && a.localName === 'ruby') throw new LyricsError('TTML ruby annotations are not supported yet. Export without ruby; no lyric text was discarded or replaced.');
      if (a.namespaceURI === STYLE || ['style', 'region'].includes(a.localName)) notices.add('File styling and regions are replaced by this player’s font, colors and layout.');
      if (['obscene', 'empty-beat'].includes(a.localName)) notices.add(`The ${a.localName} extension is preserved in the saved source but has no special visual treatment.`);
    }
  }
  for (const element of named(root, 'agent').filter(element => element.namespaceURI === META)) {
    const id = attr(element, 'id', XML);
    if (id) agents[id] = named(element, 'name')[0]?.textContent?.trim() || id;
  }
  const head = children(root).find(element => element.localName === 'head');
  if (head) {
    const known = new Set(['metadata', 'agent', 'name', 'title', 'desc', 'copyright', 'meta', 'styling', 'style', 'initial', 'layout', 'region', 'iTunesMetadata', 'translations', 'translation', 'transliterations', 'transliteration', 'text', 'span', 'profile', 'features', 'feature', 'extensions', 'extension']);
    for (const element of head.getElementsByTagName('*')) if (!known.has(element.localName)) notices.add(`Metadata <${element.tagName}> is preserved in the saved source but is not displayed.`);
  }
  const time = (value: string) => {
    const input = value.trim();
    let result: number;
    const offset = input.match(/^([+-]?\d+(?:\.\d+)?)(h|m|s|ms)$/);
    const clock = input.match(/^(?:(\d+):)?(\d{1,2}):([0-5]\d)(?:\.(\d+))?$/);
    if (offset) result = Number(offset[1]) * ({ h: 3600, m: 60, s: 1, ms: .001 }[offset[2]]!);
    else if (clock && Number(clock[2]) < 60) result = Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + Number(`0.${clock[4] || '0'}`);
    else if (/^\d+(?:\.\d+)?$/.test(input)) result = Number(input);
    else throw new LyricsError(`Unsupported TTML time "${input}". Use clock times or h/m/s/ms offsets; frame, tick and wall-clock timing are not supported.`);
    if (!Number.isFinite(result) || Math.abs(result) > 86400) throw new LyricsError('TTML time is outside the supported 24-hour range.');
    return result;
  };
  const bounds = (element: Element, parent: Bounds): Bounds => {
    const begin = attr(element, 'begin'), end = attr(element, 'end'), dur = attr(element, 'dur');
    const origin = apple ? 0 : parent.start;
    const start = begin === null ? parent.start : origin + time(begin);
    let stop = end === null ? parent.end : origin + time(end);
    if (dur !== null) stop = Math.min(stop, start + time(dur));
    const clipped = { start: Math.max(parent.start, start), end: Math.min(parent.end, stop) };
    if (clipped.end <= clipped.start) throw new LyricsError(`TTML <${element.localName}> has an empty or reversed time range. Check begin/end and the file’s timing convention.`);
    return clipped;
  };
  const resolveAgent = (value: string | null, previous?: string) => {
    if (!value) return previous;
    for (const id of value.trim().split(/\s+/)) {
      if (!agents[id]) { agents[id] = id; notices.add(`Performer "${id}" has no name in the file; its ID is displayed.`); }
    }
    return value.trim();
  };
  const lines: LyricLine[] = [];
  const paragraphKeys = new Set<string>();
  const processParagraph = (p: Element, parent: Bounds, inheritedAgent?: string, section?: string) => {
    const pBounds = bounds(p, parent), groupId = attr(p, 'key', APPLE) || attr(p, 'id', XML) || `p-${lines.length}`;
    if (paragraphKeys.has(groupId)) throw new LyricsError(`Duplicate TTML paragraph key "${groupId}". Give each paragraph a unique key.`);
    paragraphKeys.add(groupId);
    const voices: { line: LyricLine; bounds: Bounds; ownBegin: boolean; ownEnd: boolean }[] = [];
    const newVoice = (element: Element, b: Bounds, role: LyricLine['role'], agent?: string) => {
      const voice = { line: { id: `${groupId}-${voices.length}`, groupId, start: b.start, parts: [], role, agent, section, annotations: [] } as LyricLine,
        bounds: b, ownBegin: attr(element, 'begin') !== null, ownEnd: attr(element, 'end') !== null || attr(element, 'dur') !== null };
      voices.push(voice); return voice;
    };
    const pRole = attr(p, 'role', META);
    if (pRole && !['x-bg', 'background', 'lyrics', 'x-lead'].includes(pRole)) throw new LyricsError(`TTML paragraph role "${pRole}" is not supported.`);
    const lead = newVoice(p, pBounds, ['x-bg', 'background'].includes(pRole || '') ? 'background' : 'lead', resolveAgent(attr(p, 'agent', META), inheritedAgent));
    const walk = (element: Element, b: Bounds, voice: typeof lead, wordTime: Bounds | undefined, depth: number) => {
      if (depth > 40) throw new LyricsError('TTML nesting exceeds the supported depth of 40 elements.');
      for (const node of [...element.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
          let text = node.textContent || '';
          let space: string | null = null, ancestor: Element | null = element;
          while (ancestor && space === null) { space = attr(ancestor, 'space', XML); ancestor = ancestor.parentElement; }
          const preserve = space === 'preserve';
          if (!preserve && /^\s*$/.test(text) && /[\r\n]/.test(text)) continue;
          if (!preserve) text = text.replace(/\s+/g, ' ');
          if (text) voice.line.parts.push({ text, ...(wordTime && Number.isFinite(wordTime.end) ? wordTime : {}) });
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const child = node as Element;
        if (child.localName === 'br') { voice.line.parts.push({ text: ' ' }); notices.add('Explicit line breaks are displayed as spaces to keep lyric sentences together.'); continue; }
        if (child.localName !== 'span' || (child.namespaceURI && child.namespaceURI !== TT)) throw new LyricsError(`Unsupported TTML lyric element <${child.tagName}>. No lyrics were replaced.`);
        const role = attr(child, 'role', META), cb = bounds(child, b);
        if (role === 'x-translation' || role === 'x-roman') {
          if (named(child, 'span').length || attr(child, 'begin') || attr(child, 'end')) notices.add('Translations and romanization are displayed as line-level annotations; their nested timing is not animated.');
          voice.line.annotations.push({ text: child.textContent?.trim() || '', kind: role === 'x-translation' ? 'translation' : 'romanization', language: attr(child, 'lang', XML) || undefined });
          continue;
        }
        if (role && !['x-bg', 'background', 'lyrics', 'x-lead'].includes(role)) throw new LyricsError(`TTML role "${role}" is not supported. No lyrics were replaced.`);
        const agent = resolveAgent(attr(child, 'agent', META), voice.line.agent);
        const separate = ['x-bg', 'background'].includes(role || '') || agent !== voice.line.agent;
        if (separate) {
          const next = newVoice(child, cb, ['x-bg', 'background'].includes(role || '') ? 'background' : voice.line.role, agent);
          walk(child, cb, next, undefined, depth + 1);
        } else {
          const timed = attr(child, 'begin') !== null || attr(child, 'end') !== null || attr(child, 'dur') !== null;
          walk(child, cb, voice, timed ? cb : wordTime, depth + 1);
        }
      }
    };
    walk(p, pBounds, lead, undefined, 0);
    for (const voice of voices) {
      const parts = voice.line.parts;
      if (parts[0]) parts[0].text = parts[0].text.trimStart();
      if (parts[parts.length - 1]) parts[parts.length - 1].text = parts[parts.length - 1].text.trimEnd();
      if (!parts.some(part => part.text.trim())) continue;
      const timed = parts.filter(part => part.start !== undefined);
      const start = !voice.ownBegin && timed.length ? Math.min(...timed.map(part => part.start!)) : voice.bounds.start;
      const end = !voice.ownEnd && timed.length ? Math.max(...timed.map(part => part.end!)) : voice.bounds.end;
      if (!Number.isFinite(end)) throw new LyricsError(`TTML line "${parts.map(part => part.text).join('').slice(0, 40)}" has no finite end time. Add end/dur or timed spans.`);
      lines.push({ ...voice.line, start, end });
    }
  };
  const container = (element: Element, parent: Bounds, agent?: string, section?: string, depth = 0) => {
    if (depth > 40) throw new LyricsError('TTML nesting exceeds the supported depth of 40 elements.');
    const b = bounds(element, parent), singer = resolveAgent(attr(element, 'agent', META), agent);
    const part = attr(element, 'song-part', APPLE) || attr(element, 'songPart', APPLE) || section;
    for (const node of [...element.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) throw new LyricsError('TTML lyric text must be inside a timed paragraph (<p>).');
    }
    for (const child of children(element)) {
      if (child.localName === 'div') container(child, b, singer, part, depth + 1);
      else if (child.localName === 'p') processParagraph(child, b, singer, part);
      else throw new LyricsError(`Unsupported TTML body structure <${child.tagName}>. No lyric content was discarded.`);
    }
  };
  container(body, { start: 0, end: Infinity });
  if (!lines.length) throw new LyricsError('This TTML file contains no timed lyric text.');
  if (lines.length > 5000) throw new LyricsError('This file exceeds the limit of 5,000 lyric lines.');
  // Apple sidecar annotations reference a paragraph key rather than duplicating its words.
  for (const sidecar of named(root, 'text').filter(element => element.namespaceURI === APPLE)) {
    const reference = attr(sidecar, 'for'), parent = sidecar.parentElement?.localName;
    const target = lines.find(line => line.groupId === reference && line.role === 'lead');
    if (!target || !['translation', 'transliteration'].includes(parent || '')) throw new LyricsError(`Unsupported or unlinked Apple annotation for "${reference || '(missing key)'}". No lyrics were replaced.`);
    if (children(sidecar).length) throw new LyricsError('Nested Apple sidecar annotations are not supported yet. Use plain sidecar text or inline x-translation/x-roman annotations.');
    target.annotations.push({ text: sidecar.textContent?.trim() || '', kind: parent === 'translation' ? 'translation' : 'romanization', language: attr(sidecar.parentElement!, 'lang', XML) || undefined });
  }
  for (const line of lines) line.annotations = line.annotations.filter((annotation, index, all) => all.findIndex(other => other.text === annotation.text && other.kind === annotation.kind && other.language === annotation.language) === index);
  lines.sort((a, b) => a.start - b.start || (a.role === 'lead' ? -1 : 1));
  return { format: 'ttml', profile: apple ? 'apple' : 'standard', timing: timingKind(lines), lines, agents, notices: [...notices] };
}
