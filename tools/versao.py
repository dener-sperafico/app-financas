#!/usr/bin/env python3
"""Marca uma versão nova em todos os arquivos do app.

Assim o navegador nunca mistura um arquivo novo com outro antigo guardado.
Uso: python3 tools/versao.py   (aumenta a versão em 1)
"""
import re, pathlib
raiz = pathlib.Path(__file__).resolve().parent.parent
sw = raiz / 'sw.js'
txt = sw.read_text()
atual = int(re.search(r"const VERSION = 'af-v(\d+)'", txt).group(1))
v = atual + 1
for f in list((raiz / 'js').glob('*.js')) + [raiz / 'index.html', sw]:
    s = f.read_text()
    s = re.sub(r"(['\"](?:\./|\./js/|js/|css/|\./css/)[a-z]+\.(?:js|css))(\?v=\d+)?(['\"])", rf"\1?v={v}\3", s)
    s = re.sub(r"const VERSION = 'af-v\d+'", f"const VERSION = 'af-v{v}'", s)
    f.write_text(s)
print('versão', v)
