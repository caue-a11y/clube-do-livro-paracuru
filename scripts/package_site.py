#!/usr/bin/env python3
"""Empacota somente arquivos públicos para GitHub Pages. Sem credenciais ou dados."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '_site'
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
for name in ('index.html', 'admin.html'):
    shutil.copy2(ROOT / name, OUT / name)
for name in ('src', 'shared'):
    shutil.copytree(ROOT / name, OUT / name)
(OUT / '.nojekyll').write_text('', encoding='utf-8')
print('Site empacotado em _site, sem SQL, testes, documentos ou dados de respostas.')
