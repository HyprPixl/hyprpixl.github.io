import os
import re

PLACEHOLDER = '<!--#include nav.html -->'
NAV_PATH = os.path.join(os.path.dirname(__file__), '..', 'partials', 'nav.html')
NAV_RE = re.compile(r'<nav>[\s\S]*?</nav>', re.MULTILINE)

with open(NAV_PATH, 'r', encoding='utf-8') as f:
    nav = f.read().strip()

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

for dirpath, _, files in os.walk(root_dir):
    for file in files:
        if file.endswith('.html'):
            path = os.path.join(dirpath, file)
            with open(path, 'r', encoding='utf-8') as fh:
                content = fh.read()

            new_content = content
            if PLACEHOLDER in content:
                new_content = content.replace(PLACEHOLDER, nav)
            else:
                new_content = NAV_RE.sub(nav, content, count=1)

            if new_content != content:
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(new_content)
