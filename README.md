# Caleb Fedyshen’s Blogthing

Your problem, solved with software. Styled like it’s 1997.

This is the code for my [personal blog](https://hyprpixl.github.io/) where I write about:
- software development and data architecture
- university advice for CS students
- job hunting, internships, and tech careers
- anything else I feel like yelling into the starfield void

The site uses:
- GitHub Pages for hosting
- Primarily HTML and CSS (with a strong 90s aesthetic), plus small JavaScript files for optional features
- Tiled backgrounds, `<marquee>`, 88×31 buttons

## Posts

All blog posts live in the [`/posts`](posts/) directory. Each post is a standalone HTML file.

## Layout

- The center column is the main blog post list
- The left sidebar is a reading list with links to favorite articles, videos, and books
- The right sidebar is reserved for projects (coming soon)

On narrow screens, the layout reflows to a vertical stack: blog → projects → reading list.

## Tools and Assets

- Hosted with GitHub Pages
- A tiny Python script (`scripts/build.py`) inserts shared HTML snippets
- Retro assets from:
  - [vilgacx/88x31](https://github.com/vilgacx/88x31)
  - [aharris88/retro-assets](https://github.com/aharris88/retro-assets)

## Run Locally

You can run this site locally by opening `index.html` in a browser. No server needed.
If you change `partials/nav.html` or any header section, you can run:

```bash
python3 scripts/build.py
```

But you don't have to—the `Build Site` GitHub Action runs this script
on every push to `main` and commits the updated HTML automatically.

To publish:
1. Fork or clone the repo
2. Enable GitHub Pages in your repository settings
3. Push your changes to `main` or a `gh-pages` branch

## Contact

Built by Caleb Fedyshen  
Email: [hyprpixlstudios@gmail.com](mailto:hyprpixlstudios@gmail.com)  
LinkedIn: [linkedin.com/in/caleb-fedyshen](https://www.linkedin.com/in/caleb-fedyshen)
