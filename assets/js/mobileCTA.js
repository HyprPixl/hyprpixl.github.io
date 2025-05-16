// mobileCTA.js
// Random mobile CTA logic: if the device is mobile, i.e smaller than x pixels wide, we don't go to the desktop-preferred link, which is a godot html5 simulation. instead we pick a random link from the page. 

document.addEventListener("DOMContentLoaded", function() {
  if (window.matchMedia("(max-width:968px)").matches) {
    const reading = [...document.querySelectorAll(".reading-sidebar ul li a")]
      .map(a => a.href);
    const posts = [...document.querySelectorAll(".main-column ul li a")]
      .map(a => a.href);
    const pool = reading.concat(posts);
    if (pool.length) {
      const randomHref = pool[Math.floor(Math.random() * pool.length)];
      const cta = document.querySelector(".buttons88x31 a");
      if (cta) cta.href = randomHref;
    }
  }
});
