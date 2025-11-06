// styleToggle.js - Handle Modern Style Toggle
(() => {
  const STORAGE_KEY = 'hyprpixl-style-preference';
  const MODERN_CLASS = 'modern-style';
  
  // Check if user has a saved preference
  const savedStyle = localStorage.getItem(STORAGE_KEY);
  
  // Apply saved style immediately to prevent flash
  if (savedStyle === 'modern') {
    document.body.classList.add(MODERN_CLASS);
  }
  
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('style-toggle-btn');
    if (!btn) return;
    
    // Set initial button text based on current state
    updateButtonText(btn);
    
    // Toggle style on button click
    btn.addEventListener('click', () => {
      const isModern = document.body.classList.toggle(MODERN_CLASS);
      
      // Save preference
      localStorage.setItem(STORAGE_KEY, isModern ? 'modern' : 'retro');
      
      // Update button text
      updateButtonText(btn);
      
      // If switching to retro and lava lamp was on, keep it on
      // If switching to modern, turn off lava lamp
      if (isModern && document.body.classList.contains('lava-on')) {
        const lavaBtn = document.getElementById('lava-toggle-btn');
        if (lavaBtn) {
          lavaBtn.click(); // Turn off lava lamp
        }
      }
    });
  });
  
  function updateButtonText(btn) {
    const isModern = document.body.classList.contains(MODERN_CLASS);
    btn.textContent = isModern ? '✨ Retro Style' : '✨ Modern Style';
  }
})();
