import os
import re

POSTS = [
    {"date": "30 Mar 2026", "href": "chronolisten.html", "title": "I Built the Audiobook App That Didn't Exist"},
    {"date": "21 Aug 2025", "href": "lifehacks.html", "title": "Lifehacks"},
    {"date": "20 Jun 2025", "href": "software-isnt-dead-your-time-is-now.html", "title": "Software Isn't Dead. Your Time Is Now"},
    {"date": "15 Jun 2025", "href": "killing-expensive-enterprise-software.html", "title": "Expensive Enterprise Software Is Dying. I Saved $70K/Month by Killing It."},
    {"date": "5 May 2025", "href": "pacesetter-launch.html", "title": "Launching the Plains Pacesetter Step Challenge"},
    {"date": "30 Apr 2025", "href": "deploying-python-apps-databricks.html", "title": "Deploying Python Apps on Databricks: What No One Tells You"},
    {"date": "30 Nov 2024", "href": "killing-it-in-cs-part-2.html", "title": "Killing It in Computer Science (Part 2)"},
    {"date": "25 Nov 2024", "href": "ai-mistakes-internship-apps.html", "title": "The Worst Ways to Use AI in Internship / Job Apps"},
    {"date": "20 Nov 2024", "href": "internships-hard-to-get.html", "title": "Internships Are Hard to Get, These Tips Might Help"},
    {"date": "15 Nov 2024", "href": "three-best-strategies-cs-degree.html", "title": "Three Strategies for Killing a CS Degree"},
]

PLACEHOLDER = '<!--#include related-posts -->'
RELATED_RE = re.compile(r'<section class="keep-reading">[\s\S]*?</section>', re.MULTILINE)
POSTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'posts'))


def pick_related(current_href):
    idx = next((i for i, p in enumerate(POSTS) if p["href"] == current_href), None)
    others = [p for p in POSTS if p["href"] != current_href]
    if len(others) <= 3:
        return others
    if idx is None:
        return others[:3]
    selected = []
    # adjacent newer post
    if idx > 0:
        selected.append(POSTS[idx - 1])
    # adjacent older post
    if idx < len(POSTS) - 1:
        selected.append(POSTS[idx + 1])
    # fill to 3 from the top of the list (newest first), skip already picked
    picked_hrefs = {p["href"] for p in selected}
    for p in POSTS:
        if len(selected) >= 3:
            break
        if p["href"] != current_href and p["href"] not in picked_hrefs:
            selected.append(p)
            picked_hrefs.add(p["href"])
    return selected


def build_related_html(current_href):
    related = pick_related(current_href)
    items = "\n".join(
        f'    <li><time>{p["date"]}</time> <a href="{p["href"]}">{p["title"]}</a></li>'
        for p in related
    )
    return (
        '<section class="keep-reading">\n'
        '<h2>&#9658; Keep Reading</h2>\n'
        '<ul>\n'
        f'{items}\n'
        '</ul>\n'
        '</section>'
    )


for fname in os.listdir(POSTS_DIR):
    if not fname.endswith('.html'):
        continue

    path = os.path.join(POSTS_DIR, fname)
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()

    related_html = build_related_html(fname)

    if PLACEHOLDER in content:
        new_content = content.replace(PLACEHOLDER, related_html)
    elif RELATED_RE.search(content):
        new_content = RELATED_RE.sub(related_html, content, count=1)
    else:
        new_content = content.replace('</article>', related_html + '\n</article>', 1)

    if new_content != content:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(new_content)
