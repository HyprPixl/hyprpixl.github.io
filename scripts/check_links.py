import os
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse

# We'll use HTMLParser to parse the HTML and extract href/src values
class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for attr, value in attrs:
            if attr in ("href", "src") and value:
                self.links.append((tag, attr, value))


def is_external(url):
    parsed = urlparse(url)
    if parsed.scheme in ("http", "https", "mailto", "tel"):
        return True
    return False


def check_html_file(path, root_dir):
    parser = LinkParser()
    with open(path, "r", encoding="utf-8") as f:
        try:
            parser.feed(f.read())
        except Exception as e:
            print(f"Error parsing {path}: {e}")
            return False

    errors = []
    dir_path = os.path.dirname(path)
    for tag, attr, link in parser.links:
        if is_external(link) or link.startswith('#'):
            continue
        # Remove query params and fragments
        link_clean = link.split('#')[0].split('?')[0]
        if link_clean.startswith('/'):
            full_path = os.path.join(root_dir, link_clean.lstrip('/'))
        else:
            full_path = os.path.join(dir_path, link_clean)

        if not os.path.exists(full_path):
            errors.append(f"{path}: {attr} '{link}' -> {full_path} not found")

    for e in errors:
        print(e)
    return len(errors) == 0


def main():
    root_dir = os.getcwd()
    if len(sys.argv) > 1:
        root_dir = sys.argv[1]
    ok = True
    for dirpath, dirs, files in os.walk(root_dir):
        for file in files:
            if file.endswith('.html'):
                html_path = os.path.join(dirpath, file)
                if not check_html_file(html_path, root_dir):
                    ok = False
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
