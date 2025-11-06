/**
 * styleToggle.js - Handles switching between retro and modern styles
 */

(() => {
  // Create and inject the modern stylesheet link
  const modernStylesheet = document.createElement('link');
  modernStylesheet.rel = 'stylesheet';
  modernStylesheet.href = '/assets/css/modern.css';
  modernStylesheet.id = 'modern-stylesheet';
  
  // Check localStorage for saved preference
  const savedStyle = localStorage.getItem('siteStyle');
  const isModern = savedStyle === 'modern';
  
  // Apply saved preference on load
  if (isModern) {
    document.head.appendChild(modernStylesheet);
    document.body.classList.add('modern-style');
  }
  
  // Create the toggle button
  const createToggleButton = () => {
    const btn = document.createElement('button');
    btn.id = 'style-toggle-btn';
    btn.className = 'lava-button';
    btn.textContent = isModern ? '🕹️ Retro' : '✨ Modern';
    btn.title = 'Toggle between retro and modern styles';
    btn.style.marginLeft = '8px';
    
    btn.addEventListener('click', () => {
      const currentlyModern = document.body.classList.contains('modern-style');
      
      if (currentlyModern) {
        // Switch to retro
        document.body.classList.remove('modern-style');
        const stylesheet = document.getElementById('modern-stylesheet');
        if (stylesheet) {
          stylesheet.remove();
        }
        btn.textContent = '✨ Modern';
        localStorage.setItem('siteStyle', 'retro');
      } else {
        // Switch to modern
        document.body.classList.add('modern-style');
        if (!document.getElementById('modern-stylesheet')) {
          document.head.appendChild(modernStylesheet);
        }
        btn.textContent = '🕹️ Retro';
        localStorage.setItem('siteStyle', 'modern');
      }
    });
    
    return btn;
  };
  
  // Add button to the page
  const addButtonToPage = () => {
    // Try to find the lava button container
    const buttonsContainer = document.querySelector('.buttons88x31');
    if (buttonsContainer) {
      const toggleBtn = createToggleButton();
      // Insert the button near the lava lamp button
      const lavaBtn = document.getElementById('lava-toggle-btn');
      if (lavaBtn) {
        lavaBtn.parentNode.insertBefore(toggleBtn, lavaBtn.nextSibling);
      } else {
        buttonsContainer.appendChild(toggleBtn);
      }
    } else {
      // Fallback: add to nav if buttons container doesn't exist
      const nav = document.querySelector('nav');
      if (nav) {
        const toggleBtn = createToggleButton();
        nav.appendChild(toggleBtn);
      }
    }
  };
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButtonToPage);
  } else {
    addButtonToPage();
  }
})();
