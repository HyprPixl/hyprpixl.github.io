import os

BASE_URL = "https://hyprpixl.github.io"


def gather_html_files(root="."):
    files = []
    for dirpath, dirs, filenames in os.walk(root):
        for name in filenames:
            if name.endswith(".html"):
                rel_path = os.path.relpath(os.path.join(dirpath, name), root)
                files.append(rel_path)
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
