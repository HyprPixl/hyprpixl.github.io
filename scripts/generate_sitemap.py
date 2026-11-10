import os

BASE_URL = "https://hyprpixl.github.io"


def gather_html_files(root="."):
    files = []
    exclude = {"partials", "scripts", "assets"}
    for dirpath, dirs, filenames in os.walk(root):
        dirs[:] = [d for d in dirs if d not in exclude]
        for name in filenames:
            if name.endswith(".html"):
                path = os.path.join(dirpath, name)
                with open(path, encoding="utf-8", errors="ignore") as fh:
                    if 'name="robots" content="noindex"' in fh.read(4096):
                        continue  # e.g. tools like the wallfacer editor
                files.append(os.path.relpath(path, root))
    return sorted(files)


def main():
    pages = gather_html_files(".")
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write("<?xml version='1.0' encoding='UTF-8'?>\n")
        f.write("<urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>\n")
        for page in pages:
            url = f"{BASE_URL}/{page.replace(os.sep, '/')}"
            f.write("  <url>\n")
            f.write(f"    <loc>{url}</loc>\n")
            f.write("  </url>\n")
        f.write("</urlset>\n")


if __name__ == "__main__":
    main()
