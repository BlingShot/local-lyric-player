import { ImportIds, assertProjectIdentity } from './importIds.ts';
import { NS, decodeId } from './projectExport.ts';
import { newProject, tokenize, unit, vocalLine, STRUCTURES, type StudioProject, type VocalLine, type Unit, type Section } from './project.ts';

const attr = (e: Element, name: string, ns?: string) => ns ? e.getAttributeNS(ns, name) : e.getAttribute(name);
export function parseTtmlMillis(input: string): number {
  const value = input.trim(), offset = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/), clock = value.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)(?:\.(\d+))?$/);
  let ms: number;
  if (offset) ms = Number(offset[1]) * ({ h: 3600000, m: 60000, s: 1000, ms: 1 }[offset[2]]!);
  else if (clock) ms = (Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + Number(`0.${clock[4] || 0}`)) * 1000;
  else if (/^\d+(?:\.\d+)?$/.test(value)) ms = Number(value) * 1000;
  else throw new Error(`Unsupported TTML time: ${value}. Use media clock times or h/m/s/ms offsets; frames, ticks and wallclock are not supported.`);
  if (!Number.isFinite(ms) || ms > 86400000) throw new Error('TTML time exceeds the supported 24-hour range.');
  return Math.round(ms);
}
interface Bounds { start: number; end: number | null }
export function importProjectTtml(source: string, trackId: string, fileName: string): StudioProject {
  if (source.length > 2_000_000) throw new Error('TTML exceeds 2 MB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('DTD and entity declarations are forbidden. No external resources are loaded.');
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('This TTML file is not valid XML.');
  const root = xml.documentElement;
  if (root.localName !== 'tt' || root.namespaceURI !== NS.tt) throw new Error('Expected the TTML namespace and a tt root.');
  const ttmlElement = (element: Element) => element.namespaceURI === NS.tt || element.namespaceURI === null;
  if ([...root.children].some(e => !['head', 'body'].includes(e.localName) || !ttmlElement(e))) throw new Error('Only head and body are supported under the TTML root.');
  const all = [root, ...root.getElementsByTagName('*')];
  if (all.length > 50000) throw new Error('TTML exceeds 50,000 elements.');
  const notes = new Set<string>(), project = newProject(trackId, ''); project.lines = []; project.sections = []; project.metadata.extra = Object.create(null); project.metadataInitialized = true;
  const xmlIds = new Set<string>();
  const absolute = !!attr(root, 'timing', NS.apple) || all.some(e => !!attr(e, 'key', NS.apple));  const knownAttrs = new Set(['id', 'lang', 'space', 'begin', 'end', 'dur', 'timeContainer', 'timeBase', 'agent', 'role', 'type', 'key', 'value', 'timing', 'song-part', 'songPart', 'for']);
  for (const e of all) {
    const xmlId = attr(e, 'id', NS.xml); if (xmlId) { if (xmlIds.has(xmlId)) throw new Error(`Duplicate XML ID: ${xmlId}.`); xmlIds.add(xmlId); }
    if (['audio', 'image', 'resources', 'set', 'animate', 'animation'].includes(e.localName)) throw new Error(`Unsupported TTML <${e.localName}>; external resources are never loaded.`);
    if (attr(e, 'timeContainer') && attr(e, 'timeContainer') !== 'par') throw new Error('Sequential timing containers are not supported.');
    if (attr(e, 'timeBase', NS.param) && attr(e, 'timeBase', NS.param) !== 'media') throw new Error('Only media time is supported.');
    for (const a of e.attributes) {
      if (['repeatCount', 'repeatDur', 'condition', 'ruby'].includes(a.localName)) throw new Error(`Unsupported TTML ${a.localName}. Keep the source; this structure cannot yet be edited losslessly.`);
      if (a.namespaceURI !== NS.xmlns && (!knownAttrs.has(a.localName) || a.namespaceURI && !Object.values(NS).includes(a.namespaceURI))) notes.add(`Attribute ${a.name} is retained in the project source but is not exported.`);
    }
  }
  const encoding = all.filter(e => e.localName === 'meta' && e.namespaceURI === NS.amll && attr(e, 'key') === 'localMusic:idEncoding');
  const encoded = encoding.length === 1 && attr(encoding[0], 'value') === 'utf8-hex-v1';
  const ids = new ImportIds(xmlIds, encoded ? decodeId : undefined);
  const nodeIndex = new Map(all.map((e, i) => [e, i]));
  const entities = new WeakMap<Element, Map<string, string>>(), claimed = new Set<string>();
  const ownId = (e: Element, prefix: string, derived = false): string => {
    let kinds = entities.get(e); if (!kinds) { kinds = new Map(); entities.set(e, kinds); }
    const previous = kinds.get(prefix); if (previous) return previous;
    const raw = attr(e, 'id', NS.xml), base = raw ? ids.reference(raw) : `${prefix}-import-${nodeIndex.get(e)}`;
    // A leaf span used as a voice container is also a word. The word keeps
    // the external identity; the derived voice must have its own stable ID.
    const separate = derived || prefix === 'l' && e.localName === 'span' && !e.children.length;
    const id = raw && !separate && !claimed.has(base) ? base : ids.allocate(separate ? `${base}~${prefix}` : base);
    claimed.add(id); kinds.set(prefix, id); return id;
  };
  const bounds = (e: Element, parent: Bounds, limit: Bounds = parent): Bounds => {
    const begin = attr(e, 'begin'), end = attr(e, 'end'), dur = attr(e, 'dur'), origin = absolute ? 0 : parent.start;
    const start = begin === null ? parent.start : origin + parseTtmlMillis(begin);
    let stop = end === null ? parent.end : origin + parseTtmlMillis(end);
    if (dur !== null) stop = Math.min(stop ?? Infinity, start + parseTtmlMillis(dur));
    if (start < limit.start || stop !== null && limit.end !== null && stop > limit.end) notes.add('A child exceeds its declared parent time range. Effective times are clipped to the container; original declarations remain in project source.');
    return { start: Math.max(start, limit.start), end: limit.end === null ? stop : stop === null ? limit.end : Math.min(stop, limit.end) };
  };
  const singer = (e: Element, inherited?: string) => { const id = attr(e, 'agent', NS.meta); return id === null ? inherited : ids.reference(id); };
  project.metadata.language = attr(root, 'lang', NS.xml) || 'und';
  for (const e of all.filter(e => e.localName === 'agent' && e.namespaceURI === NS.meta)) {
    const id = attr(e, 'id', NS.xml); if (!id) { notes.add('Unnamed agent metadata needs review.'); continue; }
    const name = e.getElementsByTagNameNS(NS.meta, 'name')[0]?.textContent || id;
    const type = attr(e, 'type', NS.meta) || attr(e, 'type'); if (type && !['group', 'person'].includes(type)) notes.add(`Performer type ${type} is retained in source; editor uses person until reassigned.`);
    project.performers.push({ id: ids.reference(id), name, type: type === 'group' ? 'group' : 'person', color: ['#1ed760', '#85b7ff', '#ffb6de'][project.performers.length % 3], align: 'auto' });
  }
  for (const e of all.filter(e => e.localName === 'meta' && e.namespaceURI === NS.amll)) { const key = attr(e, 'key'), value = attr(e, 'value'); if (key !== null && value !== null) (project.metadata.extra[key] ??= []).push(value); }
  delete project.metadata.extra['localMusic:idEncoding'];
  project.metadata.title = project.metadata.extra.musicName?.join(' / ') || all.find(e => e.localName === 'title' && e.namespaceURI === NS.meta)?.textContent || '';
  project.metadata.artist = project.metadata.extra.artists?.join(' / ') || ''; project.metadata.album = project.metadata.extra.album?.join(' / ') || '';
  for (const key of ['musicName', 'artists', 'album']) delete project.metadata.extra[key];
  const first = project.metadata.extra['localMusic:lyricStartMs']?.[0], last = project.metadata.extra['localMusic:lyricEndMs']?.[0];
  if (first !== undefined || last !== undefined) {
    if ((first !== undefined && (!/^\d+$/.test(first) || !Number.isSafeInteger(Number(first)))) || last === undefined || !/^\d+$/.test(last) || !Number.isSafeInteger(Number(last)) || Number(last) <= (first === undefined ? -1 : Number(first))) throw new Error('Invalid lyric boundary metadata.');
    project.boundaries = { startMs: first === undefined ? null : Number(first), endMs: Number(last) };
    delete project.metadata.extra['localMusic:lyricStartMs']; delete project.metadata.extra['localMusic:lyricEndMs'];
  }
  const paragraphMap = new Map<string, VocalLine>();
  function readVocal(e: Element, b: Bounds, line: VocalLine, inherited?: string, depth = 0, timed = false, onNewLeadLine?: (line: VocalLine) => void, vocalContainer: Bounds = b) {
    if (depth > 40) throw new Error('TTML nesting exceeds 40 elements.');
    const performer = singer(e, inherited);
    let textBuffer = '';
    const flush = () => {
      if (!textBuffer) return;
      let preserve: string | null = null, node: Element | null = e;
      while (node && preserve === null) { preserve = attr(node, 'space', NS.xml); node = node.parentElement; }
      const raw = textBuffer; textBuffer = '';
      const text = preserve === 'preserve' ? raw : /^\s*$/.test(raw) && /[\n\r]/.test(raw) ? '' : raw.replace(/\s+/g, ' ');
      if (!text) return;
      const ownUnit = e.localName === 'span' && !!attr(e, 'id', NS.xml) && !e.children.length;
      const units: Unit[] = timed || ownUnit ? [{ ...unit(text), id: ownUnit ? ownId(e, 'w') : ids.allocate('w-import'), startMs: timed ? b.start : null, endMs: timed ? b.end : null, performerId: performer !== line.performerId ? performer : undefined }] : tokenize(text).map(w => ({ ...w, id: ids.allocate(w.id), performerId: performer !== line.performerId ? performer : undefined }));
      line.units.push(...units);
    };
    for (const node of e.childNodes) {
      if (node.nodeType === 3 || node.nodeType === 4) { textBuffer += node.textContent || ''; continue; }
      flush(); if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (child.localName !== 'span' || !(child.namespaceURI === NS.tt || child.namespaceURI === null)) throw new Error(`Unsupported lyric element <${child.tagName}>. Current draft is unchanged.`);
      const role = attr(child, 'role', NS.meta);
      // Apple/AMLL backing vocals may outlast the lead paragraph. Keep their
      // declared times within the enclosing div/body, not the lead's interval.
      const limit = absolute && (role === 'x-bg' || role === 'background') ? vocalContainer : b;
      const cb = bounds(child, b, limit), childPerformer = singer(child, performer);
      if (role === 'x-translation' || role === 'x-roman') {
        if (child.children.length || attr(child, 'begin') !== null) notes.add('Timed/nested annotations are retained in source; edited annotations are line-level.');
        line.annotations.push({ id: ownId(child, 'a'), targetId: line.id, kind: role === 'x-translation' ? 'translation' : 'romanization', text: child.textContent || '', language: attr(child, 'lang', NS.xml) || '' }); continue;
      }
      if (role === 'x-bg' || role === 'background') {
        const bg = vocalLine('', 'background', line.parentId || line.id);
        bg.id = ownId(child, 'l'); bg.startMs = cb.start; bg.endMs = cb.end; bg.performerId = childPerformer;
        readVocal(child, cb, bg, bg.performerId, depth + 1, false, onNewLeadLine, vocalContainer); finish(bg); project.lines.push(bg); continue;
      }
      if (role && !['lyrics', 'x-lead'].includes(role)) throw new Error(`Unsupported vocal role: ${role}.`);
      // Inline timing is inherited through wrappers and mixed text, not only leaves.
      const childTimed = timed || ['begin', 'end', 'dur'].some(name => attr(child, name) !== null);
      // x-lead is a voice envelope, not a sung word. Keep the paragraph identity
      // for its backing children and do not invent word times from this wrapper.
      if (role === 'x-lead') {
        line.performerId = childPerformer; line.startMs = cb.start; line.endMs = cb.end;
        readVocal(child, cb, line, childPerformer, depth + 1, false, onNewLeadLine, vocalContainer);
        continue;
      }
      const separate = childPerformer !== line.performerId;
      if (separate) {
        const split = vocalLine('', line.role, line.parentId);
        split.id = ownId(child, 'l', true); split.startMs = cb.start; split.endMs = cb.end; split.performerId = childPerformer;
        readVocal(child, cb, split, childPerformer, depth + 1, childTimed, onNewLeadLine, vocalContainer); finish(split);
        if (onNewLeadLine) onNewLeadLine(split); else project.lines.push(split);
        continue;
      }
      if (role === 'x-lead') line.performerId = line.performerId || childPerformer;
      readVocal(child, cb, line, childPerformer, depth + 1, childTimed, onNewLeadLine, vocalContainer);
    }
    flush();
  }
  function finish(line: VocalLine) {
    line.text = line.units.map(w => w.text).join('');
    if (line.endMs === null) { const ends = line.units.map(w => w.endMs).filter((n): n is number => n !== null); if (ends.length) line.endMs = Math.max(...ends); }
  }
  function container(e: Element, parent: Bounds, inherited?: string, section?: Section, depth = 0) {
    if (depth > 40) throw new Error('TTML nesting exceeds 40 elements.');
    const b = bounds(e, parent), performer = singer(e, inherited), tag = attr(e, 'song-part', NS.apple) || attr(e, 'songPart', NS.apple);
    let current = section;
    if (tag) { const normalized = tag.toUpperCase().replace(/[-_ ]/g, '') as Section['tag']; if (STRUCTURES.includes(normalized)) { current = { id: ownId(e, 's'), tag: normalized, lineIds: [], startMs: attr(e, 'begin') !== null ? b.start : null, endMs: attr(e, 'end') !== null || attr(e, 'dur') !== null ? b.end : null }; project.sections.push(current); } else notes.add(`Unknown section ${tag} is retained in source.`); }
    for (const node of e.childNodes) if (node.nodeType === 3 && node.textContent?.trim()) throw new Error('Lyric text must be inside a paragraph.');
    for (const child of e.children) {
      if (child.namespaceURI !== null && child.namespaceURI !== NS.tt) throw new Error(`Unsupported body namespace: ${child.namespaceURI}.`);
      if (child.localName === 'div') container(child, b, performer, current, depth + 1);
      else if (child.localName === 'p') {
        const role = attr(child, 'role', NS.meta); if (role && !['lyrics', 'x-lead'].includes(role)) throw new Error(`Paragraph role ${role} is not supported by the editor. Use background spans inside a lead paragraph.`);
        const cb = bounds(child, b), line = vocalLine(); line.id = ownId(child, 'l'); line.performerId = singer(child, performer); line.startMs = cb.start; line.endMs = cb.end;
        const addLeadLine = (line: VocalLine) => { project.lines.push(line); if (line.role === 'lead') current?.lineIds.push(line.id); };
        addLeadLine(line);
        const key = attr(child, 'key', NS.apple) || attr(child, 'id', NS.xml) || line.id;
        if (paragraphMap.has(key)) throw new Error(`Duplicate paragraph key: ${key}.`);
        paragraphMap.set(key, line);
        readVocal(child, cb, line, line.performerId, 0, false, addLeadLine, b); finish(line);
        if (!line.units.length) {
          project.lines = project.lines.filter(item => item.id !== line.id);
          if (current) current.lineIds = current.lineIds.filter(id => id !== line.id);
        }
      } else throw new Error(`Unsupported TTML container <${child.tagName}>.`);
    }
  }
  const bodies = [...root.children].filter(e => e.localName === 'body' && ttmlElement(e));
  if (bodies.length !== 1) throw new Error('TTML needs exactly one body.');
  container(bodies[0], { start: 0, end: null });
  for (const e of all.filter(e => e.localName === 'text' && e.namespaceURI === NS.apple)) {
    const parent = e.parentElement, reference = attr(e, 'for') || '', line = paragraphMap.get(reference);
    if (!line || !['translation', 'transliteration'].includes(parent?.localName || '')) { notes.add(`Unlinked sidecar ${reference} is retained in source.`); continue; }
    if (e.children.length) notes.add('Nested sidecar annotation timing is retained in source; editing is line-level.');
    line.annotations.push({ id: ownId(e, 'a'), targetId: line.id, kind: parent!.localName === 'translation' ? 'translation' : 'romanization', text: e.textContent || '', language: attr(parent!, 'lang', NS.xml) || '' });
  }
  const knownHead = new Set(['metadata', 'agent', 'name', 'title', 'meta', 'translations', 'translation', 'transliterations', 'transliteration', 'text']);
  const head = [...root.children].find(e => e.localName === 'head');
  for (const e of head?.getElementsByTagName('*') || []) if (!knownHead.has(e.localName)) notes.add(`Metadata <${e.tagName}> remains in project source and is not exported.`);
  if (project.lines.length > 5000) throw new Error('Use at most 5,000 lines.');
  assertProjectIdentity(project);
  project.selectedId = project.lines[0]?.id || ''; project.settings.mode = attr(root, 'timing', NS.apple) === 'Word' || project.lines.some(l => l.units.some(w => w.startMs !== null)) ? 'word' : 'line';
  project.source = { text: source, fileName, notices: [...notes] }; return project;
}
