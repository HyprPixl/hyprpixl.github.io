// randomLink.js
// The "Click Here" 88x31 button sends you to a random page on this site, picked
// from the homepage's project and blog links (hidden pages stay hidden).

document.addEventListener("DOMContentLoaded", function() {
  const cta = document.getElementById("random-link");
  if (!cta) return;
  cta.addEventListener("click", function(e) {
    const pool = [...document.querySelectorAll(".projects-column ul li a, .blog-sidebar ul li a")]
      .map(a => a.href)
      .filter(href => new URL(href).origin === location.origin);
    if (!pool.length) return;
    e.preventDefault();
    location.href = pool[Math.floor(Math.random() * pool.length)];
  });
});
