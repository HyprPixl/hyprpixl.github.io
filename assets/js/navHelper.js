// navHelper.js - Helper functions for navigation improvements

// Hide the current page's nav button
function hideCurrentPageButton() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('nav a');
  
  navLinks.forEach(link => {
    const linkPath = new URL(link.href).pathname;
    
    // Normalize paths for comparison (remove trailing slashes, handle index.html)
    const normalizedCurrent = currentPath.replace(/\/$/, '').replace(/\/index\.html$/, '');
    const normalizedLink = linkPath.replace(/\/$/, '').replace(/\/index\.html$/, '');
    
    // Check if this is the home page
    const isHomePage = normalizedCurrent === '' || normalizedCurrent === '/index.html' || normalizedCurrent === '/';
    const isHomeLink = normalizedLink === '' || normalizedLink === '/index.html' || normalizedLink === '/';
    
    // Hide if it's a match
    if ((isHomePage && isHomeLink) || (normalizedCurrent === normalizedLink && normalizedCurrent !== '')) {
      link.style.display = 'none';
    }
  });
}

// Make list items fully clickable in modern style
function makeListItemsClickable() {
  // Only run if body has modern-style class
  if (!document.body.classList.contains('modern-style')) {
    return;
  }
  
  // Project section list items
  const projectItems = document.querySelectorAll('body.modern-style .project-section li');
  projectItems.forEach(item => {
    const link = item.querySelector('a');
    if (link) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking on the link itself (to avoid double trigger)
        if (e.target.tagName !== 'A') {
          link.click();
        }
      });
    }
  });
  
  // Sidebar list items (reading list and blog posts)
  const sidebarItems = document.querySelectorAll('body.modern-style .reading-sidebar li, body.modern-style .blog-sidebar li');
  sidebarItems.forEach(item => {
    const link = item.querySelector('a');
    if (link) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking on the link itself
        if (e.target.tagName !== 'A') {
          link.click();
        }
      });
    }
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  hideCurrentPageButton();
  makeListItemsClickable();
});

// Re-run makeListItemsClickable when style changes
// Listen for style toggle
const styleToggleBtn = document.getElementById('style-toggle-btn');
if (styleToggleBtn) {
  styleToggleBtn.addEventListener('click', () => {
    // Use setTimeout to wait for the class to be added
    setTimeout(makeListItemsClickable, 50);
  });
}
