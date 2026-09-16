import type { StudioProject } from './project.ts';
/** One collision-checked namespace for every imported entity and reference. */
export class ImportIds {
  private mapped = new Map<string, string>();
  private used = new Set<string>();
  private reserved: Set<string>;
  constructor(rawIds: Iterable<string>, decode: (value: string) => string = value => value) {
    const entries = [...rawIds].map(raw => ({ raw, value: decode(raw) }));
    this.reserved = new Set(entries.map(entry => entry.value));
    // Prefer a literal identity when an encoded spelling decodes to the same ID.
    entries.sort((a, b) => Number(b.raw === b.value) - Number(a.raw === a.value));
    for (const { raw, value } of entries) {
      const id = !this.used.has(value) ? value : this.allocate(`${value}~import`);
      this.used.add(id); this.mapped.set(raw, id);
    }
  }
  reference(raw: string): string {
    const existing = this.mapped.get(raw);
    if (existing !== undefined) return existing;
    const id = this.allocate(raw);
    this.mapped.set(raw, id); return id;
  }
  allocate(preferred: string): string {
    let id = preferred, suffix = 1;
    while (!id || this.used.has(id) || this.reserved.has(id)) id = `${preferred}~${suffix++}`;
    this.used.add(id); return id;
  }
}

/** Validate identity/references before committing an import, even with pending times. */
export function assertProjectIdentity(project: StudioProject): void {
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (!id || ids.has(id)) throw new Error(`Duplicate or empty ID: ${id}`);
    ids.add(id);
  };
  const performers = new Set(project.performers.map(p => p.id));
  const leads = new Set(project.lines.filter(l => l.role === 'lead').map(l => l.id));
  const performer = (id?: string) => { if (id && !performers.has(id)) throw new Error(`Performer reference is missing: ${id}`); };
  for (const p of project.performers) claim(p.id);
  for (const line of project.lines) {
    claim(line.id); performer(line.performerId);
    if (line.role === 'background' && (!line.parentId || !leads.has(line.parentId))) throw new Error('Background vocal has no valid lead parent.');
    for (const word of line.units) { claim(word.id); performer(word.performerId); }
    for (const a of line.annotations) {
      claim(a.id); if (a.targetId !== line.id) throw new Error('Annotation has an invalid original-line reference.');
    }
  }
  for (const section of project.sections) {
    claim(section.id);
    if (section.lineIds.some(id => !leads.has(id))) throw new Error('Section has a missing lead line.');
  }
}
