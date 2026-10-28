#!/usr/bin/env python3
"""Gera prévia de revisão isolada. Não recebe dados nem acessa a API real."""
from pathlib import Path
import base64
import re

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
css = (root / 'src/styles.css').read_text()
js = (root / 'src/public.js').read_text()
questionnaire = (root / 'shared/questionario.json').read_bytes()
data_url = 'data:application/json;base64,' + base64.b64encode(questionnaire).decode()
js = js.replace("const { api } = await import('./api.js');", "const api = async (route) => { if (route !== '/config') throw new Error('Esta prévia não recebe respostas.'); return {open:false,form_version:'2026-10-28-v1-proposta',privacy:{responsible:null,channel:null,retention_days:null,notice_version:null}}; };")
js = js.replace("new URL('../shared/questionario.json', import.meta.url)", repr(data_url))
if 'import(' in js or 'import.meta' in js:
    raise RuntimeError('Prévia ainda contém importação externa; revise antes de publicar.')
html = html.replace('<title>Clube do livro · Paracuru</title>', '<title>Prévia · Clube do livro de Paracuru</title>')
html = html.replace('<link rel="stylesheet" href="./src/styles.css">', '<style>' + css + '\n.preview-banner{padding:14px max(24px,calc((100vw - 1200px)/2));background:#314b3a;color:#fff;font-size:14px;text-align:center}</style>')
html = html.replace('<script type="module" src="./src/public.js"></script>', '<script type="module">' + js.replace('</script', '<\\/script') + '</script>')
html = html.replace('<body>', '<body><div class="preview-banner" role="note">Prévia para revisão · não recebe nem salva respostas · publicação no GitHub ainda pendente</div>')
html = html.replace('href="./index.html"', 'href="#hero-title"')
html = re.sub(r'<a href="\./admin\.html">.*?</a>', '<span>Painel privado disponível na aplicação completa</span>', html)
out = root.parent / 'clube-do-livro-previa.html'
out.write_text(html)
print(out)
