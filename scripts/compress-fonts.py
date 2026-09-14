"""Developer-only lossless WOFF2 packaging. Original TTF sources stay untouched.
Setup: python -m pip install --target .cache/font-tools 'fonttools[woff]==4.65.0'
"""
import sys
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / '.cache/font-tools'))
from fontTools import __version__
from fontTools.ttLib import TTFont, woff2
from fontTools.pens.recordingPen import RecordingPen

results = []
for name in ('SpotifyMix-Bold', 'DMSans-Variable'):
    source = root / 'tests/fixtures/fonts' / (name + '.ttf')
    target = source.with_suffix('.woff2')
    woff2.compress(str(source), str(target))
    with TTFont(source) as before, TTFont(target) as after:
        assert before.getBestCmap() == after.getBestCmap(), name + ': character map changed'
        assert before['hmtx'].metrics == after['hmtx'].metrics, name + ': advance widths changed'
        assert before.getGlyphOrder() == after.getGlyphOrder()
        old, new = before.getGlyphSet(), after.getGlyphSet()
        for glyph in old:
            a, b = RecordingPen(), RecordingPen()
            old[glyph].draw(a); new[glyph].draw(b)
            assert a.value == b.value, name + ': outline changed at ' + glyph
        for table in ('GSUB', 'GPOS', 'gvar', 'fvar'):
            if table in before:
                assert before.reader[table] == after.reader[table], name + ': shaping/variation table changed'
        results.append(dict(font=name, sourceBytes=source.stat().st_size, woff2Bytes=target.stat().st_size, glyphs=len(old), verified=True))
out = root / 'test-results/font-compression.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(dict(tool='fontTools', version=__version__, fonts=results), indent=2))
print(out.read_text())
